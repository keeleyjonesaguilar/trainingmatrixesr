// Reads whose name is written on a scanned training document (Keeley's request, 2026-11-03): AHA
// skills checklists and the like come in as photos with handwritten names and no text in them, so
// the upload window's own name matching finds nothing. Claude looks at the page, picks which of the
// session's attendees it belongs to, and says which way up the page is. Only called from the admin
// "Upload Attendee Documents" window, one page at a time. If ANTHROPIC_API_KEY is missing this
// throws NotSetUpError, and the window just leaves the picking to you.
const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-opus-5-5';

class NotSetUpError extends Error {}

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new NotSetUpError('Reading names from cards is not set up (ANTHROPIC_API_KEY is missing).');
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });
  return client;
}

// Which way the page has to turn (clockwise) to read upright.
const TURNS = { none: 0, clockwise: 1, upside_down: 2, counterclockwise: 3 };

const SCHEMA = {
  type: 'object',
  properties: {
    name_as_written: { type: 'string', description: "The student/trainee name written on the page, as best you can read it, or '' if there isn't one." },
    attendee_number: { type: 'integer', description: 'The number of the attendee in the list whose name that is, or 0 if none of them (or you can\'t tell).' },
    turn_to_read: { type: 'string', enum: Object.keys(TURNS), description: 'How to turn the page so its printed text reads upright.' },
  },
  required: ['name_as_written', 'attendee_number', 'turn_to_read'],
  additionalProperties: false,
};

// image: { mediaType: 'image/jpeg' | 'image/png', data: base64 } of the page as it's shown now.
// attendees: [{ attendee_id, trainee_name }]. -> { attendee_id or null, name_as_written, quarter_turns }
async function readNameOnCard(image, attendees) {
  const list = attendees.map((a, i) => `${i + 1}. ${a.trainee_name}`).join('\n');
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        {
          type: 'text',
          text: `This is one scanned page from a safety training class - a skills checklist, wallet card, test or similar form. `
            + `The student's name is usually handwritten on a "Student Name" or "Name" line; ignore the instructor's name and initials. `
            + `The page may be sideways or upside down.\n\nThe class attendees are:\n${list}\n\n`
            + `Which attendee's name is on this page? Handwriting and spelling may be rough, and a first name or nickname alone `
            + `counts if it clearly fits only one attendee. If no name is written (an anonymous evaluation, say) or it doesn't `
            + `clearly fit one attendee, use 0.`,
        },
      ],
    }],
  });
  if (response.stop_reason !== 'end_turn') throw new Error(`Couldn't read the card (${response.stop_reason}).`);
  const text = response.content.find((b) => b.type === 'text')?.text || '{}';
  const answer = JSON.parse(text);
  const picked = attendees[answer.attendee_number - 1] || null;
  return {
    attendee_id: picked ? picked.attendee_id : null,
    name_as_written: String(answer.name_as_written || '').slice(0, 120),
    quarter_turns: TURNS[answer.turn_to_read] || 0,
  };
}

module.exports = { readNameOnCard, NotSetUpError };
