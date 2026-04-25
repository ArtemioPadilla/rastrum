-- Seed catalogue of badges (v0.5).
-- Apply with: make db-seed-badges
-- Idempotent: ON CONFLICT updates the metadata, never the rule.

INSERT INTO public.badges (key, name_es, name_en, description_es, description_en, category, tier, rule_json) VALUES

-- ─────────── DISCOVERY ───────────
('first_plant',       'Primera planta',         'First plant',         'Tu primera observación de una planta',                'Your first plant observation',
  'discovery','bronze', '{"type":"kingdom_first","kingdom":"Plantae"}'),
('first_animal',      'Primer animal',          'First animal',        'Tu primera observación de un animal',                 'Your first animal observation',
  'discovery','bronze', '{"type":"kingdom_first","kingdom":"Animalia"}'),
('first_fungus',      'Primer hongo',           'First fungus',        'Tu primera observación de un hongo',                  'Your first fungus observation',
  'discovery','bronze', '{"type":"kingdom_first","kingdom":"Fungi"}'),
('first_endemic_mx',  'Endémico de México',     'Mexican endemic',     'Primera especie endémica de México observada',         'First Mexican-endemic species observed',
  'discovery','silver', '{"type":"endemic_first","region":"MX"}'),
('rare_nom059',       'Especie sensible',       'Sensitive species',   'Observación de una especie en NOM-059',                'Observation of a NOM-059 listed species',
  'discovery','silver', '{"type":"nom059_any"}'),
('cloud_forest_explorer','Explorador de bosque mesófilo','Cloud-forest explorer','5 observaciones en bosque mesófilo','5 observations in cloud forest',
  'discovery','silver', '{"type":"habitat_count","habitat":"cloud_forest","threshold":5}'),

-- ─────────── MASTERY (research-grade depth) ───────────
('rg_plants_10',  'Botánico aprendiz',     'Apprentice botanist',  '10 plantas con grado-investigación','10 research-grade plants',
  'mastery','bronze', '{"type":"research_grade_count","kingdom":"Plantae","threshold":10}'),
('rg_plants_50',  'Botánico',              'Botanist',             '50 plantas con grado-investigación','50 research-grade plants',
  'mastery','silver', '{"type":"research_grade_count","kingdom":"Plantae","threshold":50}'),
('rg_plants_100', 'Botánico avanzado',     'Advanced botanist',    '100 plantas con grado-investigación','100 research-grade plants',
  'mastery','gold',   '{"type":"research_grade_count","kingdom":"Plantae","threshold":100}'),
('rg_plants_500', 'Maestro botánico',      'Master botanist',      '500 plantas con grado-investigación','500 research-grade plants',
  'mastery','platinum','{"type":"research_grade_count","kingdom":"Plantae","threshold":500}'),

('rg_birds_10',   'Observador de aves',    'Birdwatcher',          '10 aves con grado-investigación','10 research-grade birds',
  'mastery','bronze', '{"type":"research_grade_count","kingdom":"Animalia","class":"Aves","threshold":10}'),
('rg_birds_50',   'Ornitólogo',            'Ornithologist',        '50 aves con grado-investigación','50 research-grade birds',
  'mastery','silver', '{"type":"research_grade_count","kingdom":"Animalia","class":"Aves","threshold":50}'),
('rg_birds_100',  'Ornitólogo avanzado',   'Advanced ornithologist','100 aves con grado-investigación','100 research-grade birds',
  'mastery','gold',   '{"type":"research_grade_count","kingdom":"Animalia","class":"Aves","threshold":100}'),

('rg_mammals_10', 'Mastozoólogo aprendiz', 'Apprentice mammalogist','10 mamíferos con grado-investigación','10 research-grade mammals',
  'mastery','bronze', '{"type":"research_grade_count","kingdom":"Animalia","class":"Mammalia","threshold":10}'),
('rg_fungi_10',   'Micólogo aprendiz',     'Apprentice mycologist','10 hongos con grado-investigación','10 research-grade fungi',
  'mastery','bronze', '{"type":"research_grade_count","kingdom":"Fungi","threshold":10}'),

('endemic_oaxaca_10','Especialista en Oaxaca','Oaxaca specialist','10 endémicas de Oaxaca observadas','10 Oaxaca-endemic species observed',
  'mastery','silver', '{"type":"endemic_count","region":"Oaxaca","threshold":10}'),

('species_count_25', 'Naturalista de campo',  'Field naturalist',     '25 especies distintas observadas','25 distinct species observed',
  'mastery','bronze', '{"type":"species_count","threshold":25}'),
('species_count_100','Naturalista experto',   'Expert naturalist',    '100 especies distintas observadas','100 distinct species observed',
  'mastery','silver', '{"type":"species_count","threshold":100}'),
('species_count_500','Naturalista maestro',   'Master naturalist',    '500 especies distintas observadas','500 distinct species observed',
  'mastery','gold',   '{"type":"species_count","threshold":500}'),

('kingdom_diversity','Diversidad de reinos',  'Kingdom diversity',    '≥3 observaciones en cada reino (Plantae, Animalia, Fungi)','≥3 observations in every kingdom (Plantae, Animalia, Fungi)',
  'mastery','silver', '{"type":"kingdom_diversity","min_per_kingdom":3}'),

-- ─────────── CONTRIBUTION ───────────
('gbif_published_1',   'Publicado en GBIF',     'Published to GBIF',    'Tu primera observación en el dataset de GBIF','Your first observation in the GBIF dataset',
  'contribution','bronze',  '{"type":"gbif_count","threshold":1}'),
('gbif_published_50',  'Contribuyente GBIF',    'GBIF contributor',     '50 observaciones publicadas en GBIF','50 observations published to GBIF',
  'contribution','silver',  '{"type":"gbif_count","threshold":50}'),
('gbif_published_500', 'Contribuyente prolífico GBIF','Prolific GBIF contributor','500 observaciones publicadas en GBIF','500 observations published to GBIF',
  'contribution','gold',    '{"type":"gbif_count","threshold":500}'),

('validated_100',          'Validado por la comunidad','Community-validated','100 de tus observaciones validadas como grado-investigación','100 of your observations reached research-grade',
  'contribution','silver',  '{"type":"my_research_grade_count","threshold":100}'),
('validation_given_100',   'Identificador',          'Identifier',         'Has dado 100 validaciones a otros','You gave 100 validations to others',
  'contribution','silver',  '{"type":"validation_given_count","threshold":100}'),
('validation_given_500',   'Identificador prolífico','Prolific identifier','Has dado 500 validaciones a otros','You gave 500 validations to others',
  'contribution','gold',    '{"type":"validation_given_count","threshold":500}'),

-- ─────────── COMMUNITY (event-based; awarded by event-evaluator) ───────────
('bioblitz_participant',   'Participante BioBlitz',  'BioBlitz participant',  'Participaste en un BioBlitz','You participated in a BioBlitz',
  'community','bronze',     '{"type":"event_participation"}'),
('bioblitz_top_contributor','Top BioBlitz',          'BioBlitz top contributor','Top 10% en un BioBlitz por observaciones grado-investigación','Top 10% by research-grade in a BioBlitz',
  'community','gold',       '{"type":"event_top_decile"}'),
('comment_helpful_25',     'Comentarista útil',       'Helpful commenter',     '25 comentarios marcados como útiles','25 comments marked helpful',
  'community','silver',     '{"type":"helpful_comments","threshold":25}'),
('follower_50',            'Seguido por la comunidad','Community-followed',    '50 seguidores','50 followers',
  'community','silver',     '{"type":"follower_count","threshold":50}'),

-- ─────────── GOVERNANCE ───────────
('fpic_workshop',         'Taller FPIC',           'FPIC workshop',           'Completaste un taller FPIC','Completed an FPIC workshop',
  'governance','silver', '{"type":"governance_completion","course_id":"fpic"}'),
('local_contexts_trained','Local Contexts',         'Local Contexts trained',   'Completaste el entrenamiento Local Contexts BC/TK','Completed Local Contexts BC/TK training',
  'governance','silver', '{"type":"governance_completion","course_id":"local_contexts"}'),
('nom059_sensitivity',    'Sensibilidad NOM-059',  'NOM-059 sensitivity',     'Completaste el curso de sensibilización NOM-059','Completed the NOM-059 sensitivity course',
  'governance','silver', '{"type":"governance_completion","course_id":"nom059"}'),
('night_observer_15',     'Observador nocturno',   'Night observer',          '15 observaciones entre 20:00 y 05:00','15 observations between 20:00 and 05:00',
  'discovery','bronze',  '{"type":"night_count","threshold":15}'),

('first_track',  'Primera huella',     'First track',     'Tu primera observación de huella','Your first track observation',
  'discovery','bronze', '{"type":"evidence_first","evidence":"track"}'),
('first_scat',   'Primer excremento',  'First scat',      'Tu primera observación de excremento','Your first scat observation',
  'discovery','bronze', '{"type":"evidence_first","evidence":"scat"}'),
('first_burrow', 'Primera madriguera', 'First burrow',    'Tu primera observación de madriguera','Your first burrow observation',
  'discovery','bronze', '{"type":"evidence_first","evidence":"burrow"}'),
('first_nest',   'Primer nido',        'First nest',      'Tu primera observación de nido','Your first nest observation',
  'discovery','bronze', '{"type":"evidence_first","evidence":"nest"}'),
('first_camera_trap','Primera cámara trampa','First camera trap','Tu primera observación de cámara trampa','Your first camera-trap observation',
  'discovery','bronze', '{"type":"evidence_first","evidence":"camera_trap"}')

ON CONFLICT (key) DO UPDATE
SET name_es = EXCLUDED.name_es,
    name_en = EXCLUDED.name_en,
    description_es = EXCLUDED.description_es,
    description_en = EXCLUDED.description_en,
    category = EXCLUDED.category,
    tier = EXCLUDED.tier;
