CREATE OR REPLACE VIEW vw_angler_details AS
    SELECT a.id AS id,
            a.name AS name,
            a.status AS status,
            a.aliases AS aliases,
            COUNT(c.id) AS catch_count,
            biggest_catch.catch_id AS biggest_catch_id,
            biggest_catch.catch_number AS biggest_catch_number,
            MAX(c.length_in_inches) AS biggest_catch_in_inches,
            CAST(AVG(c.length_in_inches) AS decimal(10,2)) AS average_catch_in_inches,
            last_catch.catch_id AS last_catch_id,
            last_catch.catch_number AS last_catch_number,
            last_catch.caught_when AT TIME ZONE 'America/Chicago' AS last_catch_date,
            a.created_at AS created_at,
            a.updated_at AS updated_at
    FROM anglers a 
    INNER JOIN catches c ON a.id = c.angler_id
    CROSS JOIN LATERAL (
        SELECT c2.id AS catch_id, c2.catch_number AS catch_number, c2.caught_when AS caught_when
        FROM catches c2
        WHERE c2.angler_id = a.id
        ORDER BY c2.caught_when DESC
        LIMIT 1
    ) last_catch
    CROSS JOIN LATERAL (
        SELECT c3.id AS catch_id, c3.catch_number AS catch_number
        FROM catches c3
        WHERE c3.angler_id = a.id
        ORDER BY c3.length_in_inches DESC
        LIMIT 1
    ) biggest_catch
    GROUP BY a.id, a.name, a.status, a.aliases, 
             last_catch.caught_when, last_catch.catch_id, last_catch.catch_number,
             biggest_catch.catch_id, biggest_catch.catch_number
    ORDER BY a.id;