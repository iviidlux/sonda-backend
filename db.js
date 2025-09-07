// db.js (CommonJS)
const mysql = require('mysql2/promise');

function buildSSL() {
  if (process.env.DB_SSL !== 'true') return undefined;
  const ssl = { rejectUnauthorized: true };
  if (process.env.DB_SSL_CA && process.env.DB_SSL_CA.trim().length > 0) {
    ssl.ca = process.env.DB_SSL_CA;
  }
  return ssl;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  queueLimit: 0,
  ssl: buildSSL(),
});

module.exports = pool;
