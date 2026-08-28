-- Same reasoning as 027_pg_insert_order.sql: masterTrainings.js's "recently mapped aliases"
-- query ordered by SQLite's implicit rowid, which Postgres has no equivalent for.
ALTER TABLE training_aliases ADD COLUMN insert_seq BIGSERIAL;
