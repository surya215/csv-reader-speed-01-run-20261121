// Fast CSV reader: the same answers as csv-reader 1.0.0, read once left to right.
// Written from scratch in this session. The parser is index based: for each
// field it jumps with String.indexOf to the next comma and takes the field as
// one slice, so plain fields cost no per-character loop; a record with no
// quotes at all is split in one native call. Only the broken corners (a stray
// CR, an escaped quote, a line break inside quotes, a quote that never closes,
// junk after a closing quote) fall back to slow paths that walk those fields
// character by character. No dependencies, no regex on the hot path, no
// allocation per plain field beyond its own string slice.
//
// Semantics (matching csv-reader 1.0.0 exactly):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends);
//     a quote that never closes is a literal character, and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row
//     or long_row when it ends: line the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes, and row its record's
//     index in rows (null for the header).

/** How a field ended. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/**
 * Unquoted-field reader for the slow cases: parses from `pos` with an initial
 * value `init`, dropping stray CRs (each one an error). Returns
 * [value, ended, added, pos, line]; `added` counts the characters kept after
 * `init` (the caller needs it for the quote_junk rule). `pos` may equal `len`
 * (an empty field at the end of the text).
 */
function unquotedSlow(text, len, init, pos, line, recordLine, recordRow, errors) {
  let value = init;
  let added = 0;
  let p = pos;
  for (;;) {
    if (p >= len) return [value, END, added, len, line];
    const ci = text.indexOf(',', p);
    let end;
    let kind;
    if (ci === -1) {
      end = len;
      kind = END;
    } else {
      end = ci;
      kind = COMMA;
    }
    let seg = text.slice(p, end);
    const ni2 = seg.indexOf('\n');
    if (ni2 !== -1) {
      seg = seg.slice(0, ni2);
      end = p + ni2;
      kind = LINE_BREAK;
    }
    const cri = seg.indexOf('\r');
    if (cri === -1) {
      value += seg;
      added += seg.length;
      if (kind === COMMA) return [value, COMMA, added, end + 1, line];
      if (kind === LINE_BREAK) return [value, LINE_BREAK, added, end + 1, line + 1];
      return [value, END, added, len, line];
    }
    if (cri === seg.length - 1 && kind === LINE_BREAK) {
      // The CR is the last character before the LF: a CRLF line break.
      value += seg.slice(0, cri);
      added += cri;
      return [value, LINE_BREAK, added, end + 1, line + 1];
    }
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    value += seg.slice(0, cri);
    added += cri;
    p = p + cri + 1;
  }
}

/**
 * Quoted-field reader for the slow cases: the field opens at `open` and holds
 * a doubled quote (an escaped quote) or a line break before its closing quote.
 * Returns [value, ended, pos, line].
 */
function quotedSlow(text, len, open, openLine, line, recordLine, recordRow, errors) {
  const parts = [];
  let p = open + 1;
  let closedAt = -1;
  for (;;) {
    const q = text.indexOf('"', p);
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const r = unquotedSlow(text, len, '"', open + 1, openLine, recordLine, recordRow, errors);
      return [r[0], r[1], r[3], r[4]];
    }
    let seg = text.slice(p, q);
    if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
      // Each CRLF or lone CR inside quotes is read as one LF, and counts one line.
      let out = '';
      let last = 0;
      for (let i = 0; i < seg.length; i++) {
        const ch = seg.charCodeAt(i);
        if (ch === 13) {
          line += 1;
          out += seg.slice(last, i) + '\n';
          if (seg.charCodeAt(i + 1) === 10) i += 1;
          last = i + 1;
        } else if (ch === 10) {
          line += 1;
          out += seg.slice(last, i) + '\n';
          last = i + 1;
        }
      }
      out += seg.slice(last);
      seg = out;
    }
    parts.push(seg);
    if (text.charCodeAt(q + 1) === 34) {
      // A doubled quote: one literal quote, and the field goes on.
      parts.push('"');
      p = q + 2;
      continue;
    }
    closedAt = q;
    break;
  }
  const value0 = parts.join('');
  let pos = closedAt + 1;
  if (pos >= len) return [value0, END, pos, line];
  const c = text.charCodeAt(pos);
  if (c === 44) return [value0, COMMA, pos + 1, line];
  if (c === 10) return [value0, LINE_BREAK, pos + 1, line + 1];
  if (c === 13 && text.charCodeAt(pos + 1) === 10) return [value0, LINE_BREAK, pos + 2, line + 1];
  // What follows the closing quote is appended as it stands, up to the next
  // comma or line break.
  const r = unquotedSlow(text, len, value0, pos, line, recordLine, recordRow, errors);
  if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  return [r[0], r[1], r[3], r[4]];
}

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    // The record being read: the line it starts on and the index in rows it
    // takes (null: the header).
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let ended;
    let lastQuoted = false;

    // Fast path: a record with no quotes at all ends at the next LF (or the
    // end of the text), and its fields are one native split. A quote anywhere
    // before that LF means a quoted field may hide a line break, so the
    // record falls back to the field-by-field reader below.
    const ni = text.indexOf('\n', pos);
    const recEnd = ni === -1 ? len : ni;
    const seg = text.slice(pos, recEnd);
    if (seg.indexOf('"') === -1) {
      if (ni === -1) {
        if (seg.indexOf('\r') === -1) {
          fields = seg.split(',');
          ended = END;
          pos = len;
        }
      } else {
        let s = seg;
        if (s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
        if (s.indexOf('\r') === -1) {
          fields = s.split(',');
          ended = LINE_BREAK;
          pos = recEnd + 1;
          line += 1;
        }
      }
    }

    if (fields === null) {
      fields = [];
      do {
        if (pos >= len) {
          // A trailing comma at the end of the text: one last empty field.
          fields.push('');
          ended = END;
          lastQuoted = false;
          continue;
        }
        if (text.charCodeAt(pos) === 34) {
          lastQuoted = true;
          const open = pos;
          const q = text.indexOf('"', pos + 1);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the text
            // after it is read again as unquoted.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            const r = unquotedSlow(text, len, '"', open + 1, line, recordLine, recordRow, errors);
            fields.push(r[0]);
            ended = r[1];
            pos = r[3];
            line = r[4];
            continue;
          }
          if (text.charCodeAt(q + 1) === 34) {
            // A doubled quote: an escaped quote, and the field goes on.
            const r = quotedSlow(text, len, open, line, line, recordLine, recordRow, errors);
            fields.push(r[0]);
            ended = r[1];
            pos = r[2];
            line = r[3];
            continue;
          }
          const value0 = text.slice(pos + 1, q);
          if (value0.indexOf('\n') !== -1 || value0.indexOf('\r') !== -1) {
            // A line break inside the quotes: the slow reader converts it.
            const r = quotedSlow(text, len, open, line, line, recordLine, recordRow, errors);
            fields.push(r[0]);
            ended = r[1];
            pos = r[2];
            line = r[3];
            continue;
          }
          // A clean close: the field is the slice between the quotes.
          pos = q + 1;
          if (pos >= len) {
            fields.push(value0);
            ended = END;
            continue;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            fields.push(value0);
            pos += 1;
            ended = COMMA;
          } else if (c === 10) {
            fields.push(value0);
            pos += 1;
            line += 1;
            ended = LINE_BREAK;
          } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            fields.push(value0);
            pos += 2;
            line += 1;
            ended = LINE_BREAK;
          } else {
            // What follows the closing quote is appended as it stands.
            const r = unquotedSlow(text, len, value0, pos, line, recordLine, recordRow, errors);
            fields.push(r[0]);
            ended = r[1];
            pos = r[3];
            line = r[4];
            if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
          continue;
        }
        // An unquoted field: jump to the next comma; a line break before it
        // ends the field there instead.
        lastQuoted = false;
        const ci = text.indexOf(',', pos);
        let end;
        let kind;
        if (ci === -1) {
          end = len;
          kind = END;
        } else {
          end = ci;
          kind = COMMA;
        }
        let value = text.slice(pos, end);
        const ni2 = value.indexOf('\n');
        if (ni2 !== -1) {
          value = value.slice(0, ni2);
          end = pos + ni2;
          kind = LINE_BREAK;
        }
        const cri = value.indexOf('\r');
        if (cri === -1) {
          if (kind === COMMA) pos = end + 1;
          else if (kind === LINE_BREAK) {
            pos = end + 1;
            line += 1;
          } else {
            pos = len;
          }
          ended = kind;
        } else if (cri === value.length - 1 && kind === LINE_BREAK) {
          // The CR is the last character before the LF: a CRLF line break.
          value = value.slice(0, cri);
          pos = end + 1;
          line += 1;
          ended = LINE_BREAK;
        } else {
          // A stray CR: the slow reader drops it (an error) and goes on.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          const r = unquotedSlow(text, len, value.slice(0, cri), pos + cri + 1, line, recordLine, recordRow, errors);
          value = r[0];
          ended = r[1];
          pos = r[3];
          line = r[4];
        }
        fields.push(value);
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
