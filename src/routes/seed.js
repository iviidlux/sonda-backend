// src/routes/seed.js
const router = require('express').Router();
const pool = require('../../db');

// Helper para insertar si no existe y devolver id
async function upsertAndGetId(conn, table, uniqueWhere, insertData) {
  const keys = Object.keys(uniqueWhere);
  const where = keys.map(k => `${k}=?`).join(' AND ');
  const [ex] = await conn.query(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`, Object.values(uniqueWhere));
  if (ex.length) return ex[0];

  const cols = Object.keys(insertData);
  const vals = Object.values(insertData);
  const placeholders = cols.map(() => '?').join(',');
  const [ins] = await conn.query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
    vals
  );
  const [row] = await conn.query(`SELECT * FROM ${table} WHERE ${Object.keys(uniqueWhere)[0]}=?`, [ins.insertId].filter(Boolean));
  // si la PK no está en uniqueWhere, retornamos con insertId manualmente
  return row && row[0] ? row[0] : { id: ins.insertId, ...insertData };
}

// GET /api/seed/min
router.get('/min', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Estado/Municipio/CP/Colonia mínimos
    const estado = await upsertAndGetId(conn, 'estados',
      { nombre_estado: 'Tabasco' },
      { nombre_estado: 'Tabasco' }
    );

    const [munIns] = await conn.query(
      'INSERT IGNORE INTO municipios (id_estado, nombre_municipio) VALUES (?, ?)',
      [estado.id_estado, 'Centro']
    );
    const [munRow] = await conn.query('SELECT * FROM municipios WHERE id_estado=? AND nombre_municipio=? LIMIT 1',
      [estado.id_estado, 'Centro']);
    const municipio = munRow[0];

    const [cpIns] = await conn.query(
      'INSERT IGNORE INTO codigos_postales (id_municipio, codigo_postal) VALUES (?, ?)',
      [municipio.id_municipio, '86000']
    );
    const [cpRow] = await conn.query('SELECT * FROM codigos_postales WHERE id_municipio=? AND codigo_postal=? LIMIT 1',
      [municipio.id_municipio, '86000']);
    const cp = cpRow[0];

    const [colIns] = await conn.query(
      'INSERT IGNORE INTO colonias (id_cp, nombre_colonia) VALUES (?, ?)',
      [cp.id_cp, 'Centro']
    );
    const [colRow] = await conn.query('SELECT * FROM colonias WHERE id_cp=? AND nombre_colonia=? LIMIT 1',
      [cp.id_cp, 'Centro']);
    const colonia = colRow[0];

    // 2) Empresa/Sucursal mínima
    const [empIns] = await conn.query(
      `INSERT IGNORE INTO empresa_sucursal
       (id_padre, nombre, tipo, telefono, email, estado_operativo, fecha_registro, id_estado, id_cp, id_colonia, calle, numero_int_ext, referencia)
       VALUES (NULL, 'Empresa Demo', 'empresa', '9999999999', 'demo@empresa.com', 'activa', CURDATE(), ?, ?, ?, 'Calle 1', 'S/N', 'Referencia')`,
      [estado.id_estado, cp.id_cp, colonia.id_colonia]
    );
    const [empRow] = await conn.query(
      `SELECT * FROM empresa_sucursal WHERE nombre='Empresa Demo' AND tipo='empresa' LIMIT 1`
    );
    const empresa = empRow[0];

    // 3) Especie y Proceso mínimos
    const [espIns] = await conn.query(
      `INSERT IGNORE INTO especies (nombre) VALUES ('Tilapia')`
    );
    const [espRow] = await conn.query(
      `SELECT * FROM especies WHERE nombre='Tilapia' LIMIT 1`
    );
    const especie = espRow[0];

    const [procIns] = await conn.query(
      `INSERT IGNORE INTO procesos (id_especie, fecha_inicio, fecha_final)
       VALUES (?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY))`,
      [especie.id_especie]
    );
    const [procRow] = await conn.query(
      `SELECT * FROM procesos WHERE id_especie=? ORDER BY id_proceso DESC LIMIT 1`,
      [especie.id_especie]
    );
    const proceso = procRow[0];

    await conn.commit();

    res.json({
      ok: true,
      empresa_sucursal: { id_empresa_sucursal: empresa.id_empresa_sucursal, nombre: empresa.nombre },
      proceso: { id_proceso: proceso.id_proceso },
      catalogs: {
        estado: estado.nombre_estado,
        municipio: municipio.nombre_municipio,
        cp: cp.codigo_postal,
        colonia: colonia.nombre_colonia
      }
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'No se pudo generar datos mínimos', detail: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
