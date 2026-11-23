'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

let db,server,base,dir;
let freelancerCookie, clientCookie, outsiderCookie, newJobId, applicationId, freelancerId;
const credentials={ username:'alexfreelance',email:'alex@example.test',password:'SecurePass123!',role:'freelancer' };
const client={ username:'testclient',email:'client@example.test',password:'SecurePass123!',role:'client' };
const other={ username:'anotherclient',email:'another@example.test',password:'SecurePass123!',role:'client' };

before(async()=>{
  dir=mkdtempSync(path.join(tmpdir(),'bh-lab5-'));
  db=openDatabase(path.join(dir,'db.sqlite'),{seed:true});
  server=createApp({db});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  db.close();rmSync(dir,{recursive:true,force:true});
});
async function call(route,{method='GET',body,cookie,origin,headers={}}={}) {
  const requestHeaders={...headers};
  if(method!=='GET') {
    requestHeaders['X-Requested-With']='XMLHttpRequest';
    requestHeaders['Content-Type']='application/json';
  }
  if(cookie)requestHeaders.Cookie=cookie;
  if(origin)requestHeaders.Origin=origin;
  const response=await fetch(base+route,{method,headers:requestHeaders,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

test('health check and delivery of original HTML/CSS assets',async()=>{
  const health=await call('/api/health');assert.equal(health.status,200);assert.equal(health.data.database,'connected');
  const home=await call('/jobs.html');assert.equal(home.status,200);assert.match(home.data,/Bounty Hunter/);assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);
  const stylesheet=await call('/css/pages.css');assert.equal(stylesheet.status,200);
  const forbidden=await call('/server/db.js');assert.equal(forbidden.status,404);
});

test('live catalog and server-side filters',async()=>{
  const freelancers=await call('/api/freelancers');assert.equal(freelancers.data.items.length,3);
  const filtered=await call('/api/freelancers?category=backend&level=middle&rating=4');
  assert.equal(filtered.data.items.length,1);assert.equal(filtered.data.items[0].name,'Ірина Савченко');
  assert.equal((await call('/api/jobs')).data.items.length,3);
  const job=(await call('/api/jobs/1')).data.item;assert.equal(job.title,'Junior Frontend-розробник');
  assert.equal((await call('/api/jobs?category=bad')).status,400);
  assert.equal((await call('/api/freelancers/999')).status,404);
});

test('validation, registration, cookie security, login and logout',async()=>{
  const invalid=await call('/api/auth/register',{method:'POST',body:{...client,password:'short'}});
  assert.equal(invalid.status,422);
  const a=await call('/api/auth/register',{method:'POST',body:credentials});
  assert.equal(a.status,201);assert.match(a.headers.get('set-cookie'),/HttpOnly/);assert.match(a.headers.get('set-cookie'),/SameSite=Lax/);
  freelancerCookie=a.cookie;freelancerId=a.data.user.id;
  assert.equal(a.data.user.role,'freelancer');
  const c=await call('/api/auth/register',{method:'POST',body:client});assert.equal(c.status,201);clientCookie=c.cookie;
  const o=await call('/api/auth/register',{method:'POST',body:other});assert.equal(o.status,201);outsiderCookie=o.cookie;
  assert.equal((await call('/api/auth/register',{method:'POST',body:client})).status,409);
  const wrong=await call('/api/auth/login',{method:'POST',body:{username:client.username,password:'wrongpassword'}});
  assert.equal(wrong.status,401);
  const right=await call('/api/auth/login',{method:'POST',body:{username:client.username,password:client.password}});
  assert.equal(right.status,200);
  const me=await call('/api/auth/me',{cookie:clientCookie});assert.equal(me.data.user.username,client.username);
  assert.equal(me.data.user.password_hash,undefined);
  await call('/api/auth/logout',{method:'POST',cookie:right.cookie,body:{}});
  assert.equal((await call('/api/auth/me',{cookie:right.cookie})).data.user,null);
});

test('authorization and full jobs CRUD',async()=>{
  const body={title:'Новий API-розробник',company:'Demo Studio',category:'backend',level:'middle',budget:'1500 $',deadline:'14 днів',work_format:'Віддалено',description:'Побудова сервісу на Node.js та перевірка інтеграцій з API.'};
  assert.equal((await call('/api/jobs',{method:'POST',body})).status,401);
  assert.equal((await call('/api/jobs',{method:'POST',body,cookie:freelancerCookie})).status,403);
  const created=await call('/api/jobs',{method:'POST',body,cookie:clientCookie});assert.equal(created.status,201);
  newJobId=created.data.item.id;
  assert.equal((await call(`/api/jobs/${newJobId}`)).data.item.title,body.title);
  assert.equal((await call(`/api/jobs/${newJobId}`,{method:'PATCH',cookie:outsiderCookie,body:{title:'Hack'}})).status,403);
  assert.equal((await call(`/api/jobs/${newJobId}`,{method:'DELETE',cookie:outsiderCookie,body:{}})).status,403);
  const updated=await call(`/api/jobs/${newJobId}`,{method:'PATCH',cookie:clientCookie,body:{title:'Senior Backend API'}});
  assert.equal(updated.status,200);assert.equal(updated.data.item.title,'Senior Backend API');
  assert.equal((await call('/api/jobs?mine=1',{cookie:clientCookie})).data.items.length,1);
  assert.equal((await call('/api/jobs?search=Senior%20Backend')).data.items.length,1);
  assert.equal((await call(`/api/jobs/${newJobId}`,{method:'PATCH',cookie:clientCookie,body:{category:'inject'}})).status,422);
});

test('application creation, duplicate prevention, private access, status tracking',async()=>{
  const body={letter:'Маю досвід роботи з Node.js та REST API, готовий виконати завдання.',expected_rate:'300 грн/год'};
  assert.equal((await call(`/api/jobs/${newJobId}/applications`,{method:'POST',body,cookie:clientCookie})).status,403);
  const created=await call(`/api/jobs/${newJobId}/applications`,{method:'POST',body,cookie:freelancerCookie});
  assert.equal(created.status,201);applicationId=created.data.item.id;
  assert.equal((await call(`/api/jobs/${newJobId}/applications`,{method:'POST',body,cookie:freelancerCookie})).status,409);
  assert.equal((await call(`/api/applications/${applicationId}`,{cookie:outsiderCookie})).status,403);
  assert.equal((await call(`/api/applications/${applicationId}`,{cookie:freelancerCookie})).status,200);
  assert.equal((await call(`/api/applications/${applicationId}`,{method:'PATCH',cookie:freelancerCookie,body:{status:'accepted'}})).status,403);
  assert.equal((await call(`/api/applications/${applicationId}`,{method:'PATCH',cookie:outsiderCookie,body:{status:'accepted'}})).status,403);
  const accepted=await call(`/api/applications/${applicationId}`,{method:'PATCH',cookie:clientCookie,body:{status:'accepted'}});
  assert.equal(accepted.data.item.status,'accepted');
  assert.equal((await call('/api/applications/me',{cookie:freelancerCookie})).data.items.length,1);
  assert.equal((await call('/api/applications/me',{cookie:clientCookie})).data.items.length,1);
});

test('freelancer profile update is persistent and role-restricted',async()=>{
  const payload={name:'Олексій Програміст',category:'fullstack',level:'senior',availability:'busy',hourly_rate:'50 $/год',location:'Київ',bio:'Розробляю вебінтерфейси та серверні застосунки, пишу тести.',stack:['HTML','JavaScript','Node.js']};
  assert.equal((await call('/api/profile/me',{method:'PATCH',body:payload,cookie:clientCookie})).status,403);
  const updated=await call('/api/profile/me',{method:'PATCH',body:payload,cookie:freelancerCookie});
  assert.equal(updated.status,200);
  const profile=(await call(`/api/freelancers/${freelancerId}`)).data.item;
  assert.equal(profile.name,payload.name);assert.deepEqual(profile.stack,payload.stack);
  assert.equal((await call('/api/freelancers?availability=busy&category=fullstack')).data.items.length,2);
});

test('private chat, XSS-safe data transport, persistence and support form',async()=>{
  const clientId=(await call('/api/auth/me',{cookie:clientCookie})).data.user.id;
  const text='<img src=x onerror=alert(1)>';
  const sent=await call('/api/messages',{method:'POST',cookie:freelancerCookie,body:{recipient_id:clientId,content:text}});
  assert.equal(sent.status,201);assert.equal(sent.data.item.content,text);
  const read=await call(`/api/messages?with=${clientId}`,{cookie:freelancerCookie});assert.equal(read.status,200);assert.equal(read.data.items.length,1);
  assert.equal((await call(`/api/messages?with=${freelancerId}`,{cookie:clientCookie})).data.items.length,1);
  const outsider=(await call(`/api/messages?with=${clientId}`,{cookie:outsiderCookie}));assert.equal(outsider.data.items.length,0);
  assert.equal((await call('/api/messages',{method:'POST',cookie:clientCookie,body:{recipient_id:clientId,content:'self'}})).status,422);
  const sentSupport=await call('/api/support',{method:'POST',body:{body:'Не працює тестова форма входу з моїм акаунтом.'}});
  assert.equal(sentSupport.status,201);
  assert.ok(db.prepare('SELECT id FROM support_tickets WHERE id=?').get(sentSupport.data.id));
});

test('CSRF origin, content-type, JSON size and error codes',async()=>{
  const forbidden=await call('/api/support',{method:'POST',origin:'https://evil.example',body:{body:'Тестовий запит із чужого сайту.'}});
  assert.equal(forbidden.status,403);
  const wrongType=await fetch(base+'/api/support',{method:'POST',headers:{'X-Requested-With':'XMLHttpRequest','Content-Type':'text/plain'},body:'hello'});
  assert.equal(wrongType.status,415);
  const huge=await call('/api/support',{method:'POST',body:{body:'x'.repeat(40000)}});
  assert.equal(huge.status,413);
  assert.equal((await call('/api/no-such-route')).status,404);
});

test('SQLite holds real records; owner can delete with cascading applications',async()=>{
  assert.ok(db.prepare('SELECT id FROM jobs WHERE id=?').get(newJobId));
  assert.ok(db.prepare('SELECT id FROM applications WHERE id=?').get(applicationId));
  const removed=await call(`/api/jobs/${newJobId}`,{method:'DELETE',cookie:clientCookie,body:{}});
  assert.equal(removed.status,200);
  assert.equal((await call(`/api/jobs/${newJobId}`)).status,404);
  assert.equal(db.prepare('SELECT id FROM applications WHERE id=?').get(applicationId),undefined);
  assert.ok(db.prepare('SELECT id FROM messages WHERE content=?').get('<img src=x onerror=alert(1)>'));
  // A second SQLite connection verifies that writes reached the persistent file.
  const reopened=openDatabase(path.join(dir,'db.sqlite'));
  assert.ok(reopened.prepare('SELECT id FROM users WHERE username=?').get('testclient'));
  assert.ok(reopened.prepare('SELECT id FROM messages WHERE content=?').get('<img src=x onerror=alert(1)>'));
  reopened.close();
});
