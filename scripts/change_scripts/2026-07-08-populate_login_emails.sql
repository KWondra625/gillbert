--One-time, hand-edited: map each angler to the Cloudflare Access email(s) they log in with.
--Fill in the real names/emails below (one UPDATE per angler; add/remove rows as needed),
--then run against prod. Re-running is safe (each UPDATE just overwrites the array).
--An angler can have more than one login email (e.g. personal + work) — just add more entries to the array.

UPDATE anglers SET login_emails = ARRAY['kurt.wondra@outlook.com', 'kurt.wondra@yahoo.com'] WHERE name = 'Kurt';
UPDATE anglers SET login_emails = ARRAY['bbob9966@yahoo.com'] WHERE name = 'Brian';
UPDATE anglers SET login_emails = ARRAY['miami340005@gmail.com'] WHERE name = 'Korey';
UPDATE anglers SET login_emails = ARRAY['nugentc86@gmail.com'] WHERE name = 'Corey';
UPDATE anglers SET login_emails = ARRAY['mattebel@gmail.com'] WHERE name = 'Matt';
UPDATE anglers SET login_emails = ARRAY['sommer00316@yahoo.com'] WHERE name = 'Kent';
UPDATE anglers SET login_emails = ARRAY['SommerBH18@uww.edu'] WHERE name = 'Brett';
UPDATE anglers SET login_emails = ARRAY['lrwiese@gmail.com'] WHERE name = 'Landon';

--Sanity check after running:
SELECT id, name, login_emails FROM anglers ORDER BY id;