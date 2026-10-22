-- 029: más puntos de buceo en toda Filipinas para la pantalla «Puntos de buceo» (#/puntos), agrupada por zonas.
-- Solo datos: un destino nuevo (Apo Reef) y puntos para las zonas que no tenían o tenían muy pocos
-- (Sipalay, Puerto Princesa, Romblon, Siargao, Oslob/Santander).
-- Las profundidades que no están confirmadas se dejan en null (la app no las muestra).
-- Se puede volver a ejecutar sin duplicar nada.

insert into public.destinations (name, province, island_group, lat, lng) values
  ('Apo Reef', 'Occidental Mindoro', 'Mindoro', 12.66, 120.43)
on conflict (name) do nothing;

with v (name, area, province, min_d, max_d, lvl, highlight, highlight_es) as (values
  -- Apo Reef (Occidental Mindoro): parque natural, se bucea desde Sablayan o en crucero; corrientes fuertes
  ('North Wall (Apo Reef)', 'Apo Reef', 'Occidental Mindoro', 5, 40, 'advanced',
    'Dramatic drop-off with fast pelagic action',
    'Veril espectacular con mucha acción pelágica'),
  ('Shark Ridge', 'Apo Reef', 'Occidental Mindoro', 5, 40, 'advanced',
    'Drop-off with reef sharks and pelagics',
    'Veril con tiburones de arrecife y pelágicos'),
  ('Binangaan Drop-off', 'Apo Reef', 'Occidental Mindoro', 5, 40, 'advanced',
    'Steep drop-off with fast-moving pelagics',
    'Veril vertical con pelágicos en movimiento'),
  ('Apo 29', 'Apo Reef', 'Occidental Mindoro', null, null, 'advanced',
    'Seamount with swirling barracuda and several shark species',
    'Monte submarino con bancos de barracudas y varias especies de tiburón'),
  ('Hunter''s Rock', 'Apo Reef', 'Occidental Mindoro', null, null, 'advanced',
    'Seamount with sea krait gatherings in June and July',
    'Monte submarino con concentraciones de serpientes marinas en junio y julio'),

  -- Sipalay (Negros Occidental)
  ('Eva''s Point', 'Sipalay', 'Negros Occidental', 2, 28, 'open_water',
    'Densely overgrown wall at the entrance to Campomanes Bay',
    'Pared llena de vida a la entrada de la bahía de Campomanes'),
  ('Sunken Island (Sipalay)', 'Sipalay', 'Negros Occidental', 8, 25, 'open_water',
    'Popular sunken island with lots of fish and corals',
    'Isla sumergida muy popular, con muchos peces y corales'),
  ('Ballo Garden', 'Sipalay', 'Negros Occidental', 3, 25, 'open_water',
    'Varied coral garden cut by canyons',
    'Jardín de coral variado cortado por cañones'),
  ('Turtle Head Point', 'Sipalay', 'Negros Occidental', 3, 35, 'open_water',
    'Slope by Turtle Island with small and big fish',
    'Talud junto a Turtle Island con peces pequeños y grandes'),
  ('MS Jojo Wreck', 'Sipalay', 'Negros Occidental', 22, 33, 'advanced',
    'Freighter on its side on a sandbank, batfish and big lionfish',
    'Carguero tumbado sobre un banco de arena, peces murciélago y grandes peces león'),
  ('Mad Max', 'Sipalay', 'Negros Occidental', 5, 28, 'open_water',
    'Old dock with steel structures, tyres and an anchor: pipefish, stonefish, morays',
    'Antiguo muelle con estructuras de acero, neumáticos y un ancla: peces pipa, peces piedra y morenas'),
  ('Marco Polo', 'Sipalay', 'Negros Occidental', null, 27, 'advanced',
    'Direct descent in good visibility with hundreds of big fish',
    'Descenso directo con buena visibilidad y cientos de peces grandes'),
  ('Danjugan Island', 'Sipalay', 'Negros Occidental', null, null, 'open_water',
    'Nature reserve: limited dives with a permit and a reserve guide',
    'Reserva natural: pocas inmersiones, con permiso y guía de la reserva'),

  -- Puerto Princesa (Palawan): Honda Bay
  ('Pandan Island (Honda Bay)', 'Puerto Princesa', 'Palawan', null, null, 'open_water',
    'Manta ray encounters; longer boat ride',
    'Encuentros con mantas; trayecto en barco más largo'),
  ('Helen''s Garden (Honda Bay)', 'Puerto Princesa', 'Palawan', null, null, 'open_water',
    'Small shallow reef with hard and soft corals',
    'Arrecife pequeño y poco profundo con corales duros y blandos'),

  -- Romblon
  ('Logbon Sanctuary', 'Romblon', 'Romblon', null, null, 'open_water',
    'Marine sanctuary known for phantom nudibranchs',
    'Santuario marino conocido por el nudibranquio fantasma'),
  ('Bonbon Block I', 'Romblon', 'Romblon', null, null, 'open_water',
    'Colourful corals off Bonbon Beach',
    'Corales de colores frente a la playa de Bonbon'),
  ('Bangug Island', 'Romblon', 'Romblon', null, null, 'open_water',
    'Island reef, popular for night dives',
    'Arrecife de la isla, muy elegido para inmersiones nocturnas'),

  -- Siargao (Surigao del Norte)
  ('Blue Cathedral', 'Siargao', 'Surigao del Norte', null, null, 'advanced',
    'Cavern dive, often called the island''s best site; far from General Luna',
    'Inmersión en caverna, considerada la mejor de la isla; lejos de General Luna'),

  -- Oslob: Santander, en la punta sur de Cebu
  ('Wall of Death (Santander)', 'Oslob', 'Cebu', null, null, 'advanced',
    'Steep wall with strong current, nudibranchs and frogfish; mantas and whale sharks possible March to June',
    'Pared vertical con corriente fuerte, nudibranquios y peces sapo; posibles mantas y tiburones ballena de marzo a junio'),
  ('Liloan and Looc (Santander)', 'Oslob', 'Cebu', null, 25, 'open_water',
    'Slope with large coral heads, soft corals and rays',
    'Talud con grandes cabezas de coral, corales blandos y rayas')
)
insert into public.dive_sites (name, area, province, min_depth_m, max_depth_m, recommended_min, highlight, highlight_es)
select v.name, v.area, v.province, v.min_d, v.max_d, v.lvl::cert_level, v.highlight, v.highlight_es from v
where not exists (select 1 from public.dive_sites s where lower(s.name) = lower(v.name));

-- La provincia de los puntos de Davao era «Davao»; el destino es «Davao del Sur»
update public.dive_sites set province = 'Davao del Sur' where area = 'Davao' and province = 'Davao';
