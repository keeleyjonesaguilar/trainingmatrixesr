-- Real pictures of each slide on the Content page (Keeley, 2026-11-06: the cards "need to show the
-- full slide"). Each deck version is sent once to the slide converter (a private Render service,
-- esr-slide-pictures, running Gotenberg/LibreOffice) and the PDF it sends back is kept beside the
-- deck. The page draws each slide's card from its page of that PDF.
--   preview_path    the PDF, relative to DATA_DIR
--   preview_status  'pending' (waiting / being made), 'ready', 'failed', or NULL (not made yet)
--   preview_order   JSON list of the deck's slide part names in page order (page 1 = first)
ALTER TABLE content_decks ADD COLUMN IF NOT EXISTS preview_path TEXT;
ALTER TABLE content_decks ADD COLUMN IF NOT EXISTS preview_status TEXT;
ALTER TABLE content_decks ADD COLUMN IF NOT EXISTS preview_order TEXT;
ALTER TABLE content_decks ADD COLUMN IF NOT EXISTS preview_error TEXT;
ALTER TABLE content_decks ADD COLUMN IF NOT EXISTS preview_made_at TEXT;
