'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const isoNow = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, storedHash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function openDatabase(filePath, { seed = false } = {}) {
  if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('freelancer', 'client')),
      created_at TEXT NOT NULL DEFAULT (${isoNow})
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'frontend' CHECK(category IN ('frontend','backend','fullstack')),
      level TEXT NOT NULL DEFAULT 'junior' CHECK(level IN ('junior','middle','senior')),
      rating REAL NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
      availability TEXT NOT NULL DEFAULT 'free' CHECK(availability IN ('free','busy')),
      hourly_rate TEXT NOT NULL DEFAULT 'За домовленістю',
      location TEXT NOT NULL DEFAULT 'Україна',
      bio TEXT NOT NULL DEFAULT 'Новий учасник платформи',
      stack TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('frontend','backend','fullstack')),
      level TEXT NOT NULL CHECK(level IN ('junior','middle','senior')),
      budget TEXT NOT NULL,
      deadline TEXT NOT NULL,
      work_format TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${isoNow})
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_category_level ON jobs(category, level);
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      applicant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      letter TEXT NOT NULL,
      expected_rate TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at TEXT NOT NULL DEFAULT (${isoNow}),
      UNIQUE(job_id, applicant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_id);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${isoNow}),
      CHECK(sender_id != recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, recipient_id, id);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${isoNow})
    );
  `);
  if (seed) seedDemo(db);
  return db;
}

function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const { salt, hash } = passwordHash('DemoPass123!');
  const insertUser = db.prepare('INSERT INTO users(username,email,password_salt,password_hash,role) VALUES(?,?,?,?,?)');
  const insertProfile = db.prepare('INSERT INTO profiles(user_id,name,category,level,rating,availability,hourly_rate,location,bio,stack) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const insertJob = db.prepare('INSERT INTO jobs(owner_id,title,company,category,level,budget,deadline,work_format,description) VALUES(?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const people = [
      ['vitalii', 'vitalii@example.test', 'Віталій Кравченко', 'frontend', 'junior', 4.5, 'free', '250 грн/год', 'Київ', 'Верстаю адаптивні інтерфейси на HTML, CSS і JavaScript, працюю з Figma та React. Шукаю перші комерційні проєкти.', ['HTML','CSS','JavaScript','React','Figma']],
      ['iryna', 'iryna@example.test', 'Ірина Савченко', 'backend', 'middle', 4, 'free', '22 $/год', 'Харків', 'Розробляю API на Python та Django, налаштовую бази даних PostgreSQL, пишу автотести. Досвід — 3 роки.', ['Python','Django','PostgreSQL','Docker']],
      ['andrii', 'andrii@example.test', 'Андрій Бондар', 'fullstack', 'senior', 5, 'busy', '45 $/год', 'Львів', "Повний цикл розробки вебсервісів: React, Node.js, DevOps. Керував командою з п'яти розробників.", ['React','Node.js','TypeScript','AWS','CI/CD']]
    ];
    for (const p of people) {
      const id = Number(insertUser.run(p[0],p[1],salt,hash,'freelancer').lastInsertRowid);
      insertProfile.run(id, p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9], JSON.stringify(p[10]));
    }
    const jobs = [
      ['technova','technova@example.test','Junior Frontend-розробник','TechNova','frontend','junior','800–1200 $','30 днів','Віддалено','Шукаємо початківця для роботи над інтерфейсами клієнтського порталу. Ви будете верстати сторінки за макетами Figma, підключати компоненти на React та разом із командою покращувати доступність сайту.'],
      ['dataforge','dataforge@example.test','Backend-розробник (Python/Django)','DataForge','backend','middle','2000–3000 $','60 днів','Гібрид, Київ','Потрібен розробник для створення REST API платіжного модуля. Інтеграція платіжних шлюзів, оптимізація запитів до PostgreSQL, покриття коду тестами.'],
      ['cloudbridge','cloudbridge@example.test','Fullstack-розробник','CloudBridge','fullstack','senior','5000–7000 $','90 днів','Віддалено','Побудова вебплатформи з нуля: React на фронтенді, Node.js на бекенді, налаштування CI/CD. Менторство двох молодших розробників.']
    ];
    for (const j of jobs) {
      const owner = Number(insertUser.run(j[0], j[1], salt, hash, 'client').lastInsertRowid);
      insertJob.run(owner, ...j.slice(2));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

module.exports = { openDatabase, passwordHash, verifyPassword };
