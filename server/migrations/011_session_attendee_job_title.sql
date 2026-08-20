-- Sign-in form is adding a mandatory Job Title field. Column stays nullable at the DB level
-- (historical rows have none, and SQLite ALTER TABLE ADD COLUMN NOT NULL requires a non-null
-- default) - "mandatory" is enforced in the sign-in route's validation, the same way
-- trainee_name's requiredness is enforced today despite the column having no CHECK.
ALTER TABLE session_attendees ADD COLUMN trainee_job_title TEXT;
