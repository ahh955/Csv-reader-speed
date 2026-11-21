// A fast drop-in for csv-reader 1.0.0, make.fun's own CSV reader: run(input)
// returns exactly csv-reader's answer for every input, {columns, rows, errors}.
// Written from csv-reader's written broken-row policy, not from its code.
//
// The reference reads one character at a time and builds every field a
// character at a time. This reader replaces that with native string scans:
// unquoted fields are found with indexOf (comma) plus a slice bounded by
// the line's end, quoted fields are found by scanning for the closing quote
// with indexOf, and a record whose line holds no quote and no stray CR is
// split in one native call. No per-field objects are built: a field's value
// travels in a shared variable and how it ended travels as a small integer
// code. Stray CRs, quote junk and unterminated quotes are rare, so they
// take a slower path that keeps the reference's exact errors and their
// order.
//
// How a field ended: at a comma (the record goes on), at a line break or at
// the end of the text (the record ends).
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text[0] === '\uFEFF') pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field being read: its value so far, and how many characters the
  // current unquoted scan has kept (quote_junk needs the count).
  let fv = '';
  let fadded = 0;

  // The next LF at or after the current field's start (len when there is
  // none): the bounded unquoted scanner's line end, set at each record
  // start and recomputed after any quoted field that crossed a line.
  let lineEnd = len;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto fv up to the next comma or line break: a CR
  // not followed by LF is dropped (stray_cr). Returns how the field ended.
  // The scan finds the next comma or LF with indexOf and slices the field in
  // one go; only a stray CR makes it loop, one segment per CR.
  function scanUnquoted() {
    fadded = 0;
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      if (comma === -1 && lf === -1) {
        // No more delimiters: the rest of the text is one field, minus stray CRs.
        let seg = text.slice(pos);
        let cr = seg.indexOf('\r');
        while (cr !== -1) {
          error('stray_cr');
          fv += seg.slice(0, cr);
          fadded += cr;
          seg = seg.slice(cr + 1);
          cr = seg.indexOf('\r');
        }
        fv += seg;
        fadded += seg.length;
        pos = len;
        return END;
      }
      let d;
      let isComma;
      if (comma !== -1 && (lf === -1 || comma < lf)) {
        d = comma;
        isComma = true;
      } else {
        d = lf;
        isComma = false;
      }
      const seg = text.slice(pos, d);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        fv += seg;
        fadded += seg.length;
        pos = d + 1;
        if (isComma) return COMMA;
        line += 1;
        return LINE_BREAK;
      }
      if (!isComma && cr === seg.length - 1) {
        // A CR as the last character before the LF is the CRLF line break.
        fv += seg.slice(0, -1);
        fadded += seg.length - 1;
        pos = d + 1;
        line += 1;
        return LINE_BREAK;
      }
      error('stray_cr');
      fv += seg.slice(0, cr);
      fadded += cr;
      pos += cr + 1;
    }
  }

  // Like scanUnquoted, but the field cannot run past lineEnd (the next LF at
  // or after the field's start, or the end of the text): the comma search is
  // the only indexOf on the hot path, and the line break is found without a
  // per-field LF scan. Only for fields read directly (fv starts empty);
  // quote junk and the unterminated re-read keep scanUnquoted. fadded is not
  // tracked here: nothing reads it after a directly-read field.
  // (Kept as a separate function, not inlined into run(): inlining it made
  // the warmed parse ~14% faster, but the bigger run() cost more JIT compile
  // time than the single cold driver run in the heat could repay, and the
  // cold driver was ~6% slower. The heat runs one cold process.)
  function scanUnquotedBounded() {
    fadded = 0;
    fv = '';
    for (;;) {
      const comma = text.indexOf(',', pos);
      if (comma !== -1 && comma < lineEnd) {
        const seg = text.slice(pos, comma);
        const cr = seg.indexOf('\r');
        if (cr === -1) {
          fv += seg;
          pos = comma + 1;
          return COMMA;
        }
        error('stray_cr');
        fv += seg.slice(0, cr);
        pos += cr + 1;
        continue;
      }
      // No comma before the line end: the field runs to the line end.
      const seg = text.slice(pos, lineEnd);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        fv += seg;
        if (lineEnd >= len) {
          pos = len;
          return END;
        }
        pos = lineEnd + 1;
        line += 1;
        return LINE_BREAK;
      }
      if (lineEnd < len && cr === seg.length - 1) {
        // A CR as the last character before the LF is the CRLF line break.
        fv += seg.slice(0, -1);
        pos = lineEnd + 1;
        line += 1;
        return LINE_BREAK;
      }
      error('stray_cr');
      fv += seg.slice(0, cr);
      pos += cr + 1;
    }
  }

  // The value of a quoted field's span (the text between its quotes): "" is
  // one quote, and each CRLF or lone CR inside is one LF. Counts the lines
  // the span crosses. Every quote in the span is part of a doubled pair.
  function spanValue(span) {
    let v = '';
    let i = 0;
    const n = span.length;
    while (i < n) {
      let dq = span.indexOf('"', i);
      if (dq === -1) dq = n;
      let cr = span.indexOf('\r', i);
      if (cr === -1) cr = n;
      let lf = span.indexOf('\n', i);
      if (lf === -1) lf = n;
      let m = dq < cr ? dq : cr;
      if (lf < m) m = lf;
      v += span.slice(i, m);
      if (m === n) break;
      const c = span[m];
      if (c === '"') {
        v += '"';
        i = m + 2;
      } else if (c === '\r') {
        v += '\n';
        line += 1;
        i = m + (span[m + 1] === '\n' ? 2 : 1);
      } else {
        v += '\n';
        line += 1;
        i = m + 1;
      }
    }
    return v;
  }

  // Reads a quoted field whose opening quote is at pos.
  function scanQuoted() {
    const open = pos;
    pos += 1;
    // The closing quote is the next quote not followed by another quote.
    let q = text.indexOf('"', pos);
    let doubled = false;
    while (q !== -1 && text[q + 1] === '"') {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted. No line was counted during the failed
      // scan, so the line counter is already the line the quote opened on.
      error('unterminated_quote');
      fv = '"';
      pos = open + 1;
      return scanUnquoted();
    }
    const span = text.slice(pos, q);
    if (doubled || span.indexOf('\r') !== -1 || span.indexOf('\n') !== -1) {
      fv = spanValue(span);
    } else {
      fv = span;
    }
    pos = q + 1;
    if (pos >= len) return END;
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return COMMA;
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return LINE_BREAK;
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return LINE_BREAK;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break. Its stray_cr errors come first (recorded during
    // the scan); quote_junk follows, only when the junk kept a character.
    const ended = scanUnquoted();
    if (fadded > 0) error('quote_junk');
    return ended;
  }

  // A record's width, short_row / long_row handling, and where it goes.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // The next LF at or after the record start (len when there is none): the
    // line this record starts on ends there. The fast path and the bounded
    // unquoted scanner both use it, so the LF is found once per record
    // instead of once per field. It is recomputed after any quoted field
    // that crossed a line (the line counter moved); a quoted field that
    // stayed on the line leaves it valid.
    let lf = text.indexOf('\n', pos);
    lineEnd = lf === -1 ? len : lf;

    // Record fast path: a line with no quote and no stray CR is unquoted
    // fields only, so one split reads the whole record. (A CR as the last
    // character before the LF is the CRLF terminator, not a stray CR.)
    // A record whose first field opens with a quote cannot take this path,
    // so it skips the line scans outright. The quote search stops at the
    // next quote anywhere; quotes are frequent enough that it never runs
    // far. The CR check runs on the sliced line so it can never scan past
    // the line's end.
    if (text[pos] !== '"') {
      const q0 = text.indexOf('"', pos);
      if (q0 === -1 || q0 >= lineEnd) {
        const lineStr = text.slice(pos, lineEnd);
        const crIn = lineStr.indexOf('\r');
        const crlf = lf !== -1 && lineStr.charCodeAt(lineStr.length - 1) === 13;
        if (crIn === -1 || (crlf && crIn === lineStr.length - 1)) {
          const fields = crlf ? lineStr.slice(0, -1).split(',') : lineStr.split(',');
          pos = lf === -1 ? len : lineEnd + 1;
          if (lf !== -1) line += 1;
          finishRecord(fields);
          continue;
        }
      }
    }

    const fields = [];
    let ended;
    let lastQuoted = false;
    do {
      lastQuoted = text[pos] === '"';
      if (lastQuoted) {
        const lineBefore = line;
        ended = scanQuoted();
        if (ended === COMMA && line !== lineBefore) {
          lf = text.indexOf('\n', pos);
          lineEnd = lf === -1 ? len : lf;
        }
      } else {
        ended = scanUnquotedBounded();
      }
      fields.push(fv);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
