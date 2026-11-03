-- Datos públicos para las páginas de destinos (tools/seo/README.md). Solo lee. Devuelve una fila con la columna «data».
SELECT json_object(
  'destinations', (SELECT json_group_array(json_object('name', name, 'province', province, 'island_group', island_group, 'lat', lat, 'lng', lng))
                   FROM (SELECT * FROM destinations ORDER BY island_group, name)),
  'sites', (SELECT json_group_array(json_object('name', name, 'area', area, 'min', min_depth_m, 'max', max_depth_m, 'level', recommended_min,
                   'fee', sanctuary_fee_php, 'hl', highlight, 'hl_es', highlight_es))
            FROM (SELECT * FROM dive_sites ORDER BY area, name)),
  'centers', (SELECT json_group_array(json_object('id', id, 'name', name, 'dest', destination, 'locality', locality, 'socio', json(CASE WHEN listing_status = 'socio' THEN 'true' ELSE 'false' END)))
              FROM (SELECT * FROM centers WHERE listing_status <> 'cerrado' AND name NOT LIKE 'Demo%'
                    AND (listing_status <> 'socio' OR verification_status = 'verified') ORDER BY destination, name))
) AS data;
