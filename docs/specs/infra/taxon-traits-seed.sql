-- =====================================================================
-- M01-traits — curated field-mark seed (issue #736)
--
-- 20 commonly-observed MX species, EN + ES per row, 3-5 marks each.
-- Idempotent (ON CONFLICT DO UPDATE). Apply after supabase-schema.sql.
--
-- Picking criteria for v1 — well-known to MX observers, taxonomically
-- diverse (plants / mammals / birds / reptiles / insects / fungi),
-- and with stable scientific names. Expand the catalogue via M24
-- admin once the editor UI ships.
--
-- Marks are intentionally short. They are *not* a description; they
-- are the 3-5 things you actually look at to confirm the AI's guess
-- against the photo. Source URLs link out to a non-Wikipedia source
-- where possible (Naturalista, EncicloVida, Flora del Bajío).
-- =====================================================================

-- Helper: insert traits for (scientific_name, lang, marks[], source_url).
-- Looks up taxon_id by scientific_name; skips silently if the taxon
-- isn't yet in the DB. The cascade will populate taxa rows lazily, so
-- repeated runs of this script eventually fill the table.
DO $$
DECLARE
  rec record;
  v_taxon_id uuid;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- ── Mammals ─────────────────────────────────────────────
      ('Didelphis virginiana', 'en', ARRAY[
        'Naked, hairless ears with white tips',
        'Long pink, prehensile tail (mostly bare)',
        'Pointed pink snout, dark eyes',
        'Body fur is grizzled grey-white',
        'Five toes per foot; opposable thumb on hindfoot'
      ], 'https://www.naturalista.mx/taxa/41472'),
      ('Didelphis virginiana', 'es', ARRAY[
        'Orejas desnudas con puntas blancas',
        'Cola prensil rosada, casi sin pelo',
        'Hocico largo, puntiagudo y rosado',
        'Pelaje gris-blanco mezclado',
        'Pulgar oponible en patas traseras'
      ], 'https://www.naturalista.mx/taxa/41472'),

      ('Procyon lotor', 'en', ARRAY[
        'Black "bandit" mask across the eyes',
        'Bushy tail with 5-7 dark rings',
        'Greyish-brown body, paler underneath',
        'Long, dexterous front paws',
        'Pointed face with white muzzle'
      ], 'https://www.naturalista.mx/taxa/41663'),
      ('Procyon lotor', 'es', ARRAY[
        'Antifaz negro alrededor de los ojos',
        'Cola con 5-7 anillos oscuros',
        'Pelaje gris-pardo, vientre más claro',
        'Patas delanteras largas y muy hábiles',
        'Cara puntiaguda con hocico blanco'
      ], 'https://www.naturalista.mx/taxa/41663'),

      ('Sciurus aureogaster', 'en', ARRAY[
        'Reddish-brown back, often with grey patches',
        'Belly orange-rust to whitish',
        'Long, fluffy tail nearly the body length',
        'Common in oak and pine-oak forests',
        'Diurnal, often seen on tree trunks'
      ], 'https://enciclovida.mx/especies/34928'),
      ('Sciurus aureogaster', 'es', ARRAY[
        'Espalda café-rojiza, a veces con parches grises',
        'Vientre anaranjado-rojizo o blanquecino',
        'Cola larga y peluda, casi del largo del cuerpo',
        'Común en bosques de encino y pino-encino',
        'Diurno, frecuente en troncos de árboles'
      ], 'https://enciclovida.mx/especies/34928'),

      -- ── Birds ───────────────────────────────────────────────
      ('Buteo jamaicensis', 'en', ARRAY[
        'Brick-red tail visible from above on adults',
        'Dark belly band against pale underparts',
        'Broad, rounded wings; soars in wide circles',
        'Loud descending "kee-eeee-arr" scream',
        'Often perched on poles or roadside trees'
      ], 'https://www.naturalista.mx/taxa/5212'),
      ('Buteo jamaicensis', 'es', ARRAY[
        'Cola rojo-ladrillo visible por arriba en adultos',
        'Banda oscura en el vientre sobre fondo claro',
        'Alas anchas y redondeadas, planea en círculos',
        'Grito descendente fuerte "kii-iii-aar"',
        'Frecuente en postes y árboles junto a caminos'
      ], 'https://www.naturalista.mx/taxa/5212'),

      ('Quiscalus mexicanus', 'en', ARRAY[
        'Male: glossy iridescent black with violet sheen',
        'Long, V-shaped (keel) tail',
        'Bright yellow eyes',
        'Female: smaller, brown with paler throat',
        'Loud, varied calls in city plazas'
      ], 'https://www.naturalista.mx/taxa/8062'),
      ('Quiscalus mexicanus', 'es', ARRAY[
        'Macho: negro iridiscente con brillo violeta',
        'Cola larga en forma de V (quilla)',
        'Ojo amarillo brillante',
        'Hembra: más chica, café con garganta clara',
        'Vocaliza fuerte y variado en plazas urbanas'
      ], 'https://www.naturalista.mx/taxa/8062'),

      ('Cyanocorax yncas', 'en', ARRAY[
        'Bright green back and wings',
        'Yellow underside and outer tail feathers',
        'Black throat patch and "moustache"',
        'Blue crown and face',
        'Noisy in family groups, mid-elevation forests'
      ], 'https://www.naturalista.mx/taxa/8175'),
      ('Cyanocorax yncas', 'es', ARRAY[
        'Espalda y alas verde brillante',
        'Vientre y bordes de la cola amarillos',
        'Garganta y "bigote" negros',
        'Corona y cara azules',
        'Ruidoso en grupos familiares, bosque mesófilo'
      ], 'https://www.naturalista.mx/taxa/8175'),

      ('Pitangus sulphuratus', 'en', ARRAY[
        'Bright yellow belly and breast',
        'Bold black-and-white striped head',
        'Reddish-brown wings and back',
        'Stout black bill',
        'Loud "kis-ka-DEE" call'
      ], 'https://www.naturalista.mx/taxa/127045'),
      ('Pitangus sulphuratus', 'es', ARRAY[
        'Vientre y pecho amarillo brillante',
        'Cabeza con franjas blanco y negro marcadas',
        'Alas y espalda café-rojizo',
        'Pico negro robusto',
        'Llamado fuerte "kis-ka-DI"'
      ], 'https://www.naturalista.mx/taxa/127045'),

      -- ── Reptiles ────────────────────────────────────────────
      ('Iguana iguana', 'en', ARRAY[
        'Row of spines along back from head to tail',
        'Large round scale (subtympanic plate) below the ear',
        'Adults often greenish; can turn orange in breeding males',
        'Long banded tail (longer than body)',
        'Loose skin (dewlap) under throat'
      ], 'https://www.naturalista.mx/taxa/30506'),
      ('Iguana iguana', 'es', ARRAY[
        'Hilera de espinas en la espalda, de la cabeza a la cola',
        'Escama redonda grande (subtimpánica) debajo del oído',
        'Adultos verdosos; machos reproductores tornan anaranjados',
        'Cola larga con anillos (más larga que el cuerpo)',
        'Papada (gualdrapa) suelta bajo la garganta'
      ], 'https://www.naturalista.mx/taxa/30506'),

      ('Sceloporus magister', 'en', ARRAY[
        'Stocky body with keeled, spiny scales',
        'Black wedge or collar on each shoulder',
        'Males: blue belly patches edged in black',
        'Yellow-orange under throat (males)',
        'Often seen basking on rocks in arid scrub'
      ], 'https://www.naturalista.mx/taxa/29906'),
      ('Sceloporus magister', 'es', ARRAY[
        'Cuerpo robusto con escamas aquilladas y espinosas',
        'Cuña o collar negro en cada hombro',
        'Machos: parches azules en el vientre, ribete negro',
        'Garganta amarillo-anaranjada en machos',
        'Asoleándose en rocas de matorral xerófilo'
      ], 'https://www.naturalista.mx/taxa/29906'),

      ('Crotalus atrox', 'en', ARRAY[
        'Diamond pattern down the back, fading toward tail',
        'Black-and-white banded ("coon") tail before rattle',
        'Triangular head, vertical pupils',
        'Hisses and rattles when threatened',
        'Common in MX desert and thornscrub'
      ], 'https://www.naturalista.mx/taxa/30764'),
      ('Crotalus atrox', 'es', ARRAY[
        'Patrón de rombos en la espalda, se desvanece hacia la cola',
        'Cola con anillos blanco y negro antes del cascabel',
        'Cabeza triangular, pupilas verticales',
        'Sisea y suena el cascabel cuando se le acerca',
        'Común en desiertos y matorrales espinosos de MX'
      ], 'https://www.naturalista.mx/taxa/30764'),

      -- ── Insects ─────────────────────────────────────────────
      ('Apis mellifera', 'en', ARRAY[
        'Fuzzy golden-brown thorax',
        'Abdomen banded amber and dark brown',
        'Single pair of wings folded flat at rest',
        'Visits flowers methodically; pollen on hindlegs',
        'Smaller than bumblebees, less robust'
      ], 'https://www.naturalista.mx/taxa/47219'),
      ('Apis mellifera', 'es', ARRAY[
        'Tórax peludo color dorado-pardo',
        'Abdomen con franjas ámbar y café oscuro',
        'Un par de alas plegadas planas en reposo',
        'Visita flores metódicamente; polen en patas traseras',
        'Más pequeña que abejorros, menos robusta'
      ], 'https://www.naturalista.mx/taxa/47219'),

      ('Danaus plexippus', 'en', ARRAY[
        'Bright orange wings with black veins',
        'Black wing borders studded with white spots',
        'Wingspan ~9-10 cm',
        'Slow, gliding flight pattern',
        'Larvae feed only on milkweed (Asclepias)'
      ], 'https://www.naturalista.mx/taxa/48662'),
      ('Danaus plexippus', 'es', ARRAY[
        'Alas naranja brillante con venas negras',
        'Bordes negros con puntos blancos',
        'Envergadura ~9-10 cm',
        'Vuelo lento y planeador',
        'Las orugas sólo comen algodoncillo (Asclepias)'
      ], 'https://www.naturalista.mx/taxa/48662'),

      -- ── Plants ──────────────────────────────────────────────
      ('Bougainvillea spectabilis', 'en', ARRAY[
        'Three papery, bright bracts (often pink/magenta) per flower',
        'Tiny white true flowers in the centre of the bracts',
        'Long, sharp thorns on woody stems',
        'Climbing or sprawling shrub habit',
        'Leaves heart-shaped, finely hairy underneath'
      ], 'https://www.naturalista.mx/taxa/63009'),
      ('Bougainvillea spectabilis', 'es', ARRAY[
        'Tres brácteas papiráceas brillantes (rosa/magenta) por flor',
        'Flores blancas pequeñas en el centro de las brácteas',
        'Espinas largas y filosas en los tallos leñosos',
        'Arbusto trepador o extendido',
        'Hojas acorazonadas, finamente vellosas por debajo'
      ], 'https://www.naturalista.mx/taxa/63009'),

      ('Agave americana', 'en', ARRAY[
        'Rosette of thick, fleshy grey-green leaves',
        'Sharp terminal spine on each leaf tip',
        'Toothed leaf margins',
        'Towering flower stalk (up to 8 m), once in life',
        'No woody trunk — leaves rise from the ground'
      ], 'https://www.naturalista.mx/taxa/53187'),
      ('Agave americana', 'es', ARRAY[
        'Roseta de hojas gruesas, carnosas, verde-grisáceas',
        'Espina terminal puntiaguda en la punta de cada hoja',
        'Bordes de las hojas dentados',
        'Tallo floral altísimo (hasta 8 m), una sola vez en la vida',
        'Sin tronco leñoso — hojas salen del suelo'
      ], 'https://www.naturalista.mx/taxa/53187'),

      ('Opuntia ficus-indica', 'en', ARRAY[
        'Flat, oval pads ("nopales") joined in a chain',
        'Pads dotted with clusters of tiny barbed glochids',
        'Few or no large spines (cultivated forms)',
        'Yellow-orange flowers in spring',
        'Red, oval fruits (tunas) when ripe'
      ], 'https://www.naturalista.mx/taxa/52854'),
      ('Opuntia ficus-indica', 'es', ARRAY[
        'Pencas planas y ovaladas (nopales) encadenadas',
        'Pencas con grupos de gloquidios diminutos con púas',
        'Pocas o ninguna espina grande (variedades cultivadas)',
        'Flores amarillo-anaranjadas en primavera',
        'Frutos rojos y ovalados (tunas) al madurar'
      ], 'https://www.naturalista.mx/taxa/52854'),

      ('Pinus montezumae', 'en', ARRAY[
        'Long needles in bundles of 5 (sometimes 4-6)',
        'Needles 25-45 cm — among longest of MX pines',
        'Dark, deeply furrowed bark',
        'Cones large, ovoid, 12-20 cm long',
        'Mountain forests of central MX, 2400-3100 m'
      ], 'https://www.naturalista.mx/taxa/137977'),
      ('Pinus montezumae', 'es', ARRAY[
        'Acículas en grupos de 5 (a veces 4-6)',
        'Acículas de 25-45 cm — entre las más largas de los pinos MX',
        'Corteza oscura y muy surcada',
        'Conos grandes, ovoides, de 12-20 cm',
        'Bosques de montaña del centro de MX, 2400-3100 m'
      ], 'https://www.naturalista.mx/taxa/137977'),

      ('Tillandsia recurvata', 'en', ARRAY[
        'Small, ball-shaped clumps perched on tree branches',
        'Grey-green, narrow curling leaves',
        'No roots in soil — anchored to bark only',
        'Tiny purple-blue flowers when in bloom',
        'Common on mesquite and oak in dry areas'
      ], 'https://www.naturalista.mx/taxa/121063'),
      ('Tillandsia recurvata', 'es', ARRAY[
        'Pequeñas matas en forma de bola sobre ramas',
        'Hojas estrechas, grisáceas, rizadas',
        'Sin raíces en suelo — solo se ancla a la corteza',
        'Florecitas violeta-azules en floración',
        'Común en mezquite y encino en zonas secas'
      ], 'https://www.naturalista.mx/taxa/121063'),

      -- ── Fungi ───────────────────────────────────────────────
      ('Amanita muscaria', 'en', ARRAY[
        'Bright red to orange cap, 8-20 cm',
        'White warts (universal-veil remnants) on cap',
        'White gills, free from the stem',
        'Skirt-like ring on stem; bulbous base',
        'Symbiotic with pines and birches'
      ], 'https://www.naturalista.mx/taxa/49158'),
      ('Amanita muscaria', 'es', ARRAY[
        'Sombrero rojo brillante a naranja, 8-20 cm',
        'Verrugas blancas (restos del velo universal) sobre el sombrero',
        'Láminas blancas, libres del tallo',
        'Anillo en forma de falda en el tallo; base bulbosa',
        'Micorrícico con pinos y abedules'
      ], 'https://www.naturalista.mx/taxa/49158')
    ) AS s(scientific_name, lang, marks, source_url)
  LOOP
    SELECT id INTO v_taxon_id FROM public.taxa
      WHERE scientific_name = rec.scientific_name
      LIMIT 1;
    IF v_taxon_id IS NULL THEN
      -- Taxon not yet in DB — cascade will create it on first observation.
      -- Skip; re-run this seed after the taxon row exists.
      CONTINUE;
    END IF;
    INSERT INTO public.taxon_traits (taxon_id, lang, trait_marks, source_url, updated_at)
    VALUES (v_taxon_id, rec.lang, rec.marks, rec.source_url, now())
    ON CONFLICT (taxon_id, lang) DO UPDATE
    SET trait_marks = EXCLUDED.trait_marks,
        source_url  = EXCLUDED.source_url,
        updated_at  = now();
  END LOOP;
END$$;
