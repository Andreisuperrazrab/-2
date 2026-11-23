'use strict';

const http = require('node:http');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { passwordHash, verifyPassword } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const COOKIE_NAME = 'bh_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 32768;
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon'
};
const CATEGORIES = ['frontend','backend','fullstack'];
const LEVELS = ['junior','middle','senior'];

function json(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(body), ...extra });
  res.end(body);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function stringValue(obj, key, { min = 1, max = 255, optional = false } = {}) {
  if (optional && !Object.hasOwn(obj, key)) return undefined;
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new HttpError(422, `Поле «${key}» повинно містити від ${min} до ${max} символів.`);
  }
  return value.trim();
}
function choice(obj, key, choices, optional = false) {
  if (optional && !Object.hasOwn(obj,key)) return undefined;
  if (!choices.includes(obj[key])) throw new HttpError(422, `Некоректне значення поля «${key}».`);
  return obj[key];
}
function positiveId(raw) {
  const num = Number(raw);
  if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(num)) throw new HttpError(400,'Некоректний ідентифікатор.');
  return num;
}
function cleanBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400,'Потрібен JSON-об’єкт.');
  return body;
}
function jsonBody(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415,'Потрібен Content-Type: application/json.');
  return new Promise((resolve,reject) => {
    let size = 0, chunks = [], tooLarge = false;
    req.on('data', b => {
      size += b.length;
      if (size > MAX_BODY_BYTES) { tooLarge = true; chunks = []; }
      else if (!tooLarge) chunks.push(b);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413,'Завеликий JSON-запит.'));
      try { resolve(cleanBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
      catch (e) { reject(e instanceof HttpError ? e : new HttpError(400,'Некоректний JSON.')); }
    });
    req.on('error',reject);
  });
}
function normalizeError(error) {
  if (error instanceof HttpError) return error;
  if (error && (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(error.message || ''))) return new HttpError(409,'Такий запис уже існує.');
  return new HttpError(500,'Внутрішня помилка сервера.');
}
function setSessionCookie(res, token, secure) {
  const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_SECONDS : 0}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie',parts.join('; '));
}
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0,index).trim()] = part.slice(index+1).trim();
  }
  return result;
}
function publicUser(row) {
  return row ? { id:row.id, username:row.username, role:row.role } : null;
}
function queryUser(db, req) {
  const token = cookies(req)[COOKIE_NAME];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(sha256(token), Math.floor(Date.now()/1000)) || null;
}
function requiredUser(db,req,role) {
  const u = queryUser(db,req);
  if (!u) throw new HttpError(401,'Увійдіть до свого акаунта.');
  if (role && u.role !== role) throw new HttpError(403,'Недостатньо прав для виконання дії.');
  return u;
}
function parseProfile(row) {
  if (!row) return null;
  return {
    id:row.user_id, user_id:row.user_id, username:row.username,
    name:row.name, category:row.category, level:row.level, rating:row.rating,
    availability:row.availability, hourly_rate:row.hourly_rate,
    location:row.location, bio:row.bio, stack:JSON.parse(row.stack)
  };
}
function lookupProfile(db,id) {
  return parseProfile(db.prepare(`SELECT p.*,u.username FROM profiles p JOIN users u ON u.id=p.user_id
    WHERE p.user_id=?`).get(id));
}
function lookupJob(db,id) {
  return db.prepare(`SELECT j.*, u.username AS owner_username FROM jobs j JOIN users u ON u.id=j.owner_id WHERE j.id=?`).get(id) || null;
}
function requireOwner(db,id,userId) {
  const job = lookupJob(db,id);
  if (!job) throw new HttpError(404,'Вакансію не знайдено.');
  if (job.owner_id !== userId) throw new HttpError(403,'Це не ваша вакансія.');
  return job;
}
function jobInput(b,partial=false) {
  const result = {};
  for (const key of ['title','company','budget','deadline','work_format','description']) {
    const value = stringValue(b,key, { min:key==='description'?20:2, max:key==='description'?3000:140, optional:partial });
    if (value !== undefined) result[key] = value;
  }
  for (const key of ['category','level']) {
    const value = choice(b,key,key==='category'?CATEGORIES:LEVELS,partial);
    if (value !== undefined) result[key] = value;
  }
  if (partial && Object.keys(result).length === 0) throw new HttpError(422,'Немає полів для оновлення.');
  return result;
}
function profileInput(b) {
  const out={};
  for (const [key,min,max] of [['name',2,80],['hourly_rate',2,60],['location',2,80],['bio',10,1500]]) {
    const val=stringValue(b,key,{min,max,optional:true}); if(val!==undefined)out[key]=val;
  }
  for (const key of ['category','level','availability']) {
    const val=choice(b,key,key==='category'?CATEGORIES:key==='level'?LEVELS:['free','busy'],true);
    if(val!==undefined)out[key]=val;
  }
  if(Object.hasOwn(b,'stack')) {
    if (!Array.isArray(b.stack) || b.stack.length>12 || b.stack.some(s=>typeof s!=='string'||s.trim().length<1||s.trim().length>32)) throw new HttpError(422,'stack: максимум 12 технологій до 32 символів кожна.');
    out.stack=JSON.stringify(b.stack.map(s=>s.trim()));
  }
  if(!Object.keys(out).length) throw new HttpError(422,'Немає полів для оновлення.');
  return out;
}

function createApp({ db, publicDir = path.resolve(__dirname,'../public'), secureCookies = process.env.NODE_ENV === 'production', appOrigin = process.env.APP_ORIGIN } = {}) {
  if (!db) throw new Error('A SQLite database instance is required');
  const root = path.resolve(publicDir);
  const rateMap = new Map();
  const rateLimit = (req) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const item = rateMap.get(ip) || { start:now, count:0 };
    if (now - item.start > 15*60*1000) { item.start=now;item.count=0; }
    item.count++;
    rateMap.set(ip,item);
    if (rateMap.size > 2000) for (const [key,value] of rateMap) { if(now-value.start>15*60*1000) rateMap.delete(key); }
    if (item.count>30) throw new HttpError(429,'Забагато спроб. Спробуйте пізніше.');
  };
  const securityHeaders = {
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };

  async function route(req,res) {
    const requestUrl = new URL(req.url,'http://localhost');
    const pathname = requestUrl.pathname;
    const method = req.method || 'GET';
    for(const [k,v] of Object.entries(securityHeaders)) res.setHeader(k,v);
    // Cookies are SameSite=Lax. Additionally require a same-origin fetch marker or a matching Origin on writes.
    if (pathname.startsWith('/api/') && ['POST','PATCH','PUT','DELETE'].includes(method)) {
      const origin = req.headers.origin;
      const expectedOrigin = appOrigin || `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
      if (origin) {
        if (origin !== expectedOrigin) throw new HttpError(403,'Неприпустиме джерело запиту (Origin).');
      } else if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
        throw new HttpError(403,'Необхідний same-origin запит.');
      }
    }
    if (pathname === '/api/health' && method === 'GET') {
      db.prepare('SELECT 1').get();
      return json(res,200,{status:'ok',database:'connected',app:'Bounty Hunter'});
    }
    if (pathname === '/api/auth/me' && method === 'GET') return json(res,200,{user:publicUser(queryUser(db,req))});
    if (pathname === '/api/auth/register' && method === 'POST') {
      rateLimit(req);
      const b=await jsonBody(req);
      const username=stringValue(b,'username',{min:3,max:32});
      const email=stringValue(b,'email',{min:5,max:254}).toLowerCase();
      const password=stringValue(b,'password',{min:8,max:128});
      const role=choice(b,'role',['freelancer','client']);
      if(!/^[A-Za-z0-9_-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422,'Перевірте логін (латиниця, цифри, _ або -) та email.');
      const hashed=passwordHash(password);
      db.exec('BEGIN IMMEDIATE');
      let userId;
      try {
        userId=Number(db.prepare('INSERT INTO users(username,email,password_salt,password_hash,role) VALUES(?,?,?,?,?)').run(username,email,hashed.salt,hashed.hash,role).lastInsertRowid);
        if (role === 'freelancer') db.prepare('INSERT INTO profiles(user_id,name) VALUES(?,?)').run(userId,username);
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
      const token=createSession(db,userId);
      setSessionCookie(res,token,secureCookies);
      return json(res,201,{user:{id:userId,username,role}});
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      rateLimit(req);
      const b=await jsonBody(req);
      const username=stringValue(b,'username',{min:3,max:254});
      const password=stringValue(b,'password',{min:1,max:128});
      const account=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
      if(!account || !verifyPassword(password,account.password_salt,account.password_hash)) throw new HttpError(401,'Неправильний логін або пароль.');
      const token=createSession(db,account.id);
      setSessionCookie(res,token,secureCookies);
      return json(res,200,{user:publicUser(account)});
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const token=cookies(req)[COOKIE_NAME];
      if(token && /^[a-f0-9]{64}$/.test(token)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
      setSessionCookie(res,'',secureCookies);
      return json(res,200,{ok:true});
    }
    if (pathname === '/api/freelancers' && method === 'GET') {
      const category=requestUrl.searchParams.get('category')||'';
      const level=requestUrl.searchParams.get('level')||'';
      const availability=requestUrl.searchParams.get('availability')||'';
      const minRating=requestUrl.searchParams.get('rating')||'';
      const search=(requestUrl.searchParams.get('search')||'').slice(0,100);
      if(category && !CATEGORIES.includes(category) || level && !LEVELS.includes(level) || availability && !['free','busy'].includes(availability) || minRating && (!Number.isFinite(Number(minRating))||Number(minRating)<0||Number(minRating)>5)) throw new HttpError(400,'Некоректні фільтри.');
      const rows=db.prepare(`SELECT p.*,u.username FROM profiles p JOIN users u ON u.id=p.user_id
        WHERE (?='' OR p.category=?) AND (?='' OR p.level=?) AND (?='' OR p.availability=?) AND p.rating>=?
        AND (lower(p.name) LIKE ? OR lower(p.bio) LIKE ?)
        ORDER BY p.rating DESC,p.user_id ASC LIMIT 100`).all(category,category,level,level,availability,availability,minRating?Number(minRating):0,`%${search.toLowerCase()}%`,`%${search.toLowerCase()}%`);
      return json(res,200,{items:rows.map(parseProfile)});
    }
    let match=pathname.match(/^\/api\/freelancers\/(\d+)$/);
    if(match && method === 'GET') {
      const item=lookupProfile(db,positiveId(match[1]));
      if(!item) throw new HttpError(404,'Профіль не знайдено.');
      return json(res,200,{item});
    }
    if (pathname === '/api/profile/me' && method === 'GET') {
      const user=requiredUser(db,req,'freelancer');
      return json(res,200,{item:lookupProfile(db,user.id)});
    }
    if (pathname === '/api/profile/me' && method === 'PATCH') {
      const user=requiredUser(db,req,'freelancer');
      const input=profileInput(await jsonBody(req));
      const keys=Object.keys(input);
      db.prepare(`UPDATE profiles SET ${keys.map(k=>k+'=?').join(',')} WHERE user_id=?`).run(...keys.map(k=>input[k]),user.id);
      return json(res,200,{item:lookupProfile(db,user.id)});
    }
    if (pathname === '/api/jobs' && method === 'GET') {
      const category=requestUrl.searchParams.get('category')||'';
      const level=requestUrl.searchParams.get('level')||'';
      const search=(requestUrl.searchParams.get('search')||'').slice(0,100);
      const onlyMine=requestUrl.searchParams.get('mine')==='1';
      if ((category&&!CATEGORIES.includes(category))||(level&&!LEVELS.includes(level))) throw new HttpError(400,'Некоректні фільтри.');
      const me=onlyMine?requiredUser(db,req):null;
      const items=db.prepare(`SELECT j.*,u.username AS owner_username FROM jobs j JOIN users u ON u.id=j.owner_id
        WHERE (?='' OR j.category=?) AND (?='' OR j.level=?) AND (?=0 OR j.owner_id=?)
        AND (lower(j.title) LIKE ? OR lower(j.description) LIKE ? OR lower(j.company) LIKE ?)
        ORDER BY j.id DESC LIMIT 100`).all(category,category,level,level,onlyMine?1:0,me?me.id:-1,...Array(3).fill(`%${search.toLowerCase()}%`));
      return json(res,200,{items});
    }
    if (pathname === '/api/jobs' && method === 'POST') {
      const user=requiredUser(db,req,'client');
      const b=jobInput(await jsonBody(req));
      const result=db.prepare(`INSERT INTO jobs(owner_id,title,company,category,level,budget,deadline,work_format,description)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(user.id,b.title,b.company,b.category,b.level,b.budget,b.deadline,b.work_format,b.description);
      return json(res,201,{item:lookupJob(db,Number(result.lastInsertRowid))});
    }
    match=pathname.match(/^\/api\/jobs\/(\d+)$/);
    if(match) {
      const id=positiveId(match[1]);
      if(method==='GET') {
        const item=lookupJob(db,id);
        if(!item) throw new HttpError(404,'Вакансію не знайдено.');
        return json(res,200,{item});
      }
      if(method==='PATCH') {
        const user=requiredUser(db,req,'client');
        requireOwner(db,id,user.id);
        const b=jobInput(await jsonBody(req),true);
        const keys=Object.keys(b);
        db.prepare(`UPDATE jobs SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`).run(...keys.map(k=>b[k]),id);
        return json(res,200,{item:lookupJob(db,id)});
      }
      if(method==='DELETE') {
        const user=requiredUser(db,req,'client');
        requireOwner(db,id,user.id);
        db.prepare('DELETE FROM jobs WHERE id=?').run(id);
        return json(res,200,{ok:true});
      }
    }
    match=pathname.match(/^\/api\/jobs\/(\d+)\/applications$/);
    if(match && method==='POST') {
      const user=requiredUser(db,req,'freelancer');
      const job=lookupJob(db,positiveId(match[1]));
      if(!job) throw new HttpError(404,'Вакансію не знайдено.');
      const b=await jsonBody(req);
      const letter=stringValue(b,'letter',{min:10,max:2000});
      const rate=stringValue(b,'expected_rate',{min:2,max:100});
      const result=db.prepare('INSERT INTO applications(job_id,applicant_id,letter,expected_rate) VALUES(?,?,?,?)').run(job.id,user.id,letter,rate);
      return json(res,201,{item:lookupApplication(db,Number(result.lastInsertRowid))});
    }
    if(pathname==='/api/applications/me' && method==='GET') {
      const user=requiredUser(db,req);
      const filter=user.role==='freelancer'?'a.applicant_id=?':'j.owner_id=?';
      const items=db.prepare(`SELECT a.*,j.title AS job_title,j.owner_id,u.username AS applicant_username
        FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users u ON u.id=a.applicant_id
        WHERE ${filter} ORDER BY a.id DESC LIMIT 100`).all(user.id);
      return json(res,200,{items});
    }
    match=pathname.match(/^\/api\/applications\/(\d+)$/);
    if(match) {
      const user=requiredUser(db,req);
      const item=lookupApplication(db,positiveId(match[1]));
      if(!item) throw new HttpError(404,'Заявку не знайдено.');
      if(user.id!==item.applicant_id && user.id!==item.owner_id) throw new HttpError(403,'Немає доступу до цієї заявки.');
      if(method==='GET') return json(res,200,{item});
      if(method==='PATCH') {
        if(user.id!==item.owner_id) throw new HttpError(403,'Тільки замовник може змінювати статус.');
        const b=await jsonBody(req);
        const status=choice(b,'status',['pending','accepted','rejected']);
        db.prepare('UPDATE applications SET status=? WHERE id=?').run(status,item.id);
        return json(res,200,{item:lookupApplication(db,item.id)});
      }
    }
    if(pathname==='/api/contacts' && method==='GET') {
      const user=requiredUser(db,req);
      const items=db.prepare(`SELECT u.id,u.username,u.role,COALESCE(p.name,u.username) AS name FROM users u
        LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id != ?
        AND (p.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM jobs j WHERE j.owner_id=u.id)
        OR EXISTS(SELECT 1 FROM messages m WHERE (m.sender_id=u.id AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=u.id)))
        ORDER BY u.role DESC,name ASC LIMIT 100`).all(user.id,user.id,user.id);
      return json(res,200,{items});
    }
    if(pathname==='/api/messages' && method==='GET') {
      const user=requiredUser(db,req);
      const peer=positiveId(requestUrl.searchParams.get('with'));
      if(peer===user.id) throw new HttpError(422,'Не можна писати собі.');
      if(!db.prepare('SELECT id FROM users WHERE id=?').get(peer)) throw new HttpError(404,'Співрозмовника не знайдено.');
      const items=db.prepare(`SELECT id,sender_id,recipient_id,content,created_at FROM messages
        WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?) ORDER BY id ASC LIMIT 200`).all(user.id,peer,peer,user.id);
      return json(res,200,{items});
    }
    if(pathname==='/api/messages' && method==='POST') {
      const user=requiredUser(db,req);
      const b=await jsonBody(req);
      const peer=positiveId(b.recipient_id);
      if(peer===user.id) throw new HttpError(422,'Не можна писати собі.');
      if(!db.prepare('SELECT id FROM users WHERE id=?').get(peer)) throw new HttpError(404,'Співрозмовника не знайдено.');
      const content=stringValue(b,'content',{min:1,max:2000});
      const result=db.prepare('INSERT INTO messages(sender_id,recipient_id,content) VALUES(?,?,?)').run(user.id,peer,content);
      const item=db.prepare('SELECT id,sender_id,recipient_id,content,created_at FROM messages WHERE id=?').get(Number(result.lastInsertRowid));
      return json(res,201,{item});
    }
    if(pathname==='/api/support' && method==='POST') {
      const b=await jsonBody(req);
      const body=stringValue(b,'body',{min:10,max:2000});
      const user=queryUser(db,req);
      const result=db.prepare('INSERT INTO support_tickets(user_id,body) VALUES(?,?)').run(user?user.id:null,body);
      return json(res,201,{id:Number(result.lastInsertRowid),message:'Звернення збережено. Це навчальна демонстрація, автоматичної відповіді немає.'});
    }
    if(pathname.startsWith('/api/')) throw new HttpError(404,'Маршрут API не знайдено.');
    if(!['GET','HEAD'].includes(method)) throw new HttpError(405,'Метод не підтримується.');
    const candidate=decodeURIComponent(pathname === '/'?'/index.html':pathname);
    const target=path.resolve(root,'.'+candidate);
    if(!target.startsWith(root+path.sep)) throw new HttpError(403,'Доступ заборонено.');
    const extension=path.extname(target).toLowerCase();
    if(!MIME[extension]) throw new HttpError(404,'Сторінку не знайдено.');
    let content;
    try { const info=await stat(target); if(!info.isFile()) throw new Error('Not a file'); content=await readFile(target); }
    catch { throw new HttpError(404,'Сторінку не знайдено.'); }
    res.writeHead(200,{'Content-Type':MIME[extension],'Content-Length':content.length,'Cache-Control':extension==='.html'?'no-store':'public, max-age=300'});
    res.end(method==='HEAD'?undefined:content);
  }
  const server=http.createServer((req,res)=>{Promise.resolve(route(req,res)).catch(err=>{
    const safe=normalizeError(err);
    if(safe.status===500) console.error('[server]',err);
    if(!res.headersSent) json(res,safe.status,{error:safe.message});
    else res.end();
  });});
  return server;
}
function createSession(db,userId) {
  const token=randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Math.floor(Date.now()/1000));
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(token),userId,Math.floor(Date.now()/1000)+SESSION_SECONDS);
  return token;
}
function lookupApplication(db,id) {
  return db.prepare(`SELECT a.*, j.title AS job_title,j.owner_id,u.username AS applicant_username FROM applications a
    JOIN jobs j ON j.id=a.job_id JOIN users u ON u.id=a.applicant_id WHERE a.id=?`).get(id) || null;
}
module.exports={createApp};
