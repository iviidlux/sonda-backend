// GET /api/empresa_sucursal
router.get('/empresa_sucursal', auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id_empresa_sucursal, nombre FROM empresa_sucursal ORDER BY nombre'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron listar sucursales', detail: e.message });
  }
});
