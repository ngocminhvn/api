-- Uses existing 'encoded' kind, avoiding a CHECK constraint/table rebuild.
INSERT OR IGNORE INTO keybox_sources (name, kind, url) VALUES
 ('vsteam_hypervs', 'encoded', 'https://vsteam.vn/api/profile?type=pi&branch=HyperVS'),
 ('vsteam_colourvs', 'encoded', 'https://vsteam.vn/api/profile?type=pi&branch=ColourVS');
