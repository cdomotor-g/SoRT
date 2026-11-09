/* SoRT v2 — word.js
   The tables that paste into the assessment report. Same shape as v1 — the
   scope table, then the map picture, then the Property Services table — with
   v1's hard-won Word geometry (fixed layout, absolute widths on every cell, a
   <colgroup>), because Word's autofit otherwise squashes the left column to a
   character wide. New in v2: a Station row in the header, a Follow-up Actions
   row, the survey marks and the bridges (who manages each) under the map
   picture, and Property Services actions. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules, sch = () => S.schema;

  const WORD_TABLE_CM = 16;            // A4 portrait text width (21 cm − 2 × 2.5 cm)
  const WORD_COL_SPLIT = [1 / 3, 2 / 3];
  const CM_TO_PX = 96 / 2.54;
  const wp = cm => { const r = Math.round(cm * 100) / 100; return { cm: r, px: Math.round(r * CM_TO_PX) }; };
  const COLS = WORD_COL_SPLIT.map(f => wp(WORD_TABLE_CM * f));
  const FULL = wp(WORD_TABLE_CM);
  const w = i => (i == null ? FULL : COLS[i]);
  const wStyle = i => `width:${w(i).cm}cm;`;
  const wAttr = i => ` width="${w(i).px}"`;
  const B = 'border:1px solid #999;';
  const NOTE_B = 'border:2.25pt solid #c55a11;';   // after B, so it wins
  const FONT = 'font-family:Calibri,Arial,sans-serif;font-size:11pt;';
  const TABLE = `border-collapse:collapse;table-layout:fixed;width:${FULL.cm}cm;${FONT}`;
  const tableOpen = (cols) => {
    const cg = (cols || COLS).map(c => `<col style="width:${c.cm}cm;">`).join('');
    return `<table${wAttr()} style="${TABLE}"><colgroup>${cg}</colgroup>`;
  };
  const GAP = `<p style="margin:12px 0 0;font-family:Calibri,Arial,sans-serif;">&nbsp;</p>`;
  const esc = s => U().esc(s), escL = s => U().escLines(s);
  // An answer line (rules.outputLines): text, or { text, bold?, bullet? } — the
  // corrosion category is a bold heading over its parts, each a bullet.
  const lineHtml = l => (typeof l === 'string' ? escL(l) : `${l.bullet ? '• ' : ''}${l.bold ? `<b>${escL(l.text)}</b>` : escL(l.text)}`);
  const lineText = l => (typeof l === 'string' ? U().flat(l) : `${l.bullet ? '• ' : ''}${U().flat(l.text)}`);
  const linesText = ls => ls.map(lineText).reduce((a, l) => (a ? a + (/[.!?]$/.test(a) ? ' ' : '; ') + l : l), '');

  const td0 = (html, extra) => `<td${wAttr(0)} style="font-weight:bold;vertical-align:top;padding:6px 8px;${B}${extra || ''}${wStyle(0)}">${html}</td>`;
  const td1 = (html, extra) => `<td${wAttr(1)} style="vertical-align:top;padding:6px 8px;${B}${extra || ''}${wStyle(1)}">${html}</td>`;
  const span = (html, extra) => `<tr><td colspan="2"${wAttr()} style="padding:6px 8px;${B}${extra || ''}${wStyle()}">${html}</td></tr>`;

  // The station, on every copied table's heading and in the picture's legend —
  // a breadcrumb so a paste into the wrong report is plain to whoever reads it.
  function stationLine(s) {
    const st = s.station;
    if (!st || !st.name) return '';
    return st.number ? `${st.name} (${st.number})` : st.name;
  }
  const withStation = (title, s) => stationLine(s) ? `${title} — ${stationLine(s)}` : title;
  function attendeesLine(s) {
    const a = (s.forum.attendees || []).join(', ');
    return a + (s.forum.outOfSession ? `${a ? ' ' : ''}(out of session – scope builder only)` : '');
  }

  // ---- the scope table -------------------------------------------------------
  function scopeRows(ctx) {
    const inc = ctx.session.include;
    return R().visibleQuestions(ctx).filter(q => q.word !== false)
      .map(q => ({ q, lines: R().outputLines(ctx, q), pics: S.pictures ? S.pictures.of(ctx.session, q.code) : [] }))
      .filter(r => r.lines.length || r.pics.length || inc.empty);
  }
  // A row's pictures (js/pictures.js), under its answer and note: the in-memory
  // copy only (Copy for Word waits for them), sized in pixels to fit the answer
  // cell — Word honours width and height attributes — and never taller than
  // most of a page. The caption in italics under each.
  const PIC_MAX_W = w(1).px - 24, PIC_MAX_H = 680;
  const picCaption = p => String(p.caption || '').trim();
  function picHtml(p) {
    const rec = S.pictures.get(p.id), cap = picCaption(p);
    if (!rec) return `<i>[Picture not on this computer${cap ? `: ${esc(cap)}` : ''}]</i>`;
    const pw = rec.w || p.w || PIC_MAX_W, ph = rec.h || p.h || PIC_MAX_W;
    const k = Math.min(1, PIC_MAX_W / pw, PIC_MAX_H / ph);
    return `<img src="${rec.dataUrl}" width="${Math.max(1, Math.round(pw * k))}" height="${Math.max(1, Math.round(ph * k))}" alt="${esc(cap ? `Picture: ${cap}` : 'Picture')}" style="border:1px solid #999;">${cap ? `<br><i>${esc(cap)}</i>` : ''}`;
  }
  const picText = p => `[Picture: ${picCaption(p) || 'no caption'}]`;
  function openFollowUps(ctx, table) {
    const list = R().followUps(ctx).filter(f => !f.done && f.table === table);
    // The forum's own tasks (tasks.js) are follow-up actions too.
    if (table === 'scope' && S.tasks && S.app && S.app.session === ctx.session) list.push(...S.tasks.forWord(S.app));
    return list;
  }
  function scopeHtml(ctx) {
    const s = ctx.session, inc = s.include, tpl = ctx.tpl || {};
    let head = '';
    if (inc.header) {
      head += span(esc(withStation('SoRT Forum Agreed Remediation', s)), 'background:#1f2d3d;color:#fff;font-weight:bold;padding:8px;');
      head += span(`<b>SoRT Forum Date:</b> ${esc(U().dmy(s.forum.date) || 'dd/mm/yyyy')}`);
      head += span(`<b>SoRT Forum Attendees:</b> ${esc(attendeesLine(s))}`);
      const outcome = s.outcome && ((ctx.defs.session || {}).outcomes || []).find(o => o.code === s.outcome);
      if (outcome) head += span(`<b>SoRT Forum Outcome:</b> ${esc(outcome.label)}${s.outcomeNote ? ' — ' + escL(s.outcomeNote) : ''}`);
    }
    // The table's own title carries the station even with the header left out.
    head += span(`<i><b>${esc(withStation(tpl.title || tpl.label || '', s))}</b></i>`);
    head += `<tr>${td0('Item', 'background:#e8e8e8;')}${td1('Details', 'background:#e8e8e8;font-weight:bold;')}</tr>`;
    let rows = '';
    scopeRows(ctx).forEach(r => { rows += `<tr>${td0(esc(r.q.label))}${td1(r.lines.map(lineHtml).concat(r.pics.map(picHtml)).join('<br>'))}</tr>`; });
    if (inc.followUps) {
      const fu = openFollowUps(ctx, 'scope');
      if (fu.length) {
        const lines = fu.map(f => `• <b>${esc(f.owner)}:</b> ${esc(f.text)}${f.link ? ` <a href="${esc(f.link.url)}">${esc(f.link.label)}</a>` : ''}`);
        rows += `<tr>${td0('Follow-up Actions', 'background:#fff2cc;')}${td1(lines.join('<br>'), 'background:#fff2cc;')}</tr>`;
      }
    }
    return `${tableOpen()}${head}${rows}</table>`;
  }
  function scopeText(ctx) {
    const s = ctx.session, inc = s.include, tpl = ctx.tpl || {};
    let out = '';
    if (inc.header) {
      out += `${withStation('SoRT Forum Agreed Remediation', s)}\n`;
      out += `SoRT Forum Date: ${U().dmy(s.forum.date) || 'dd/mm/yyyy'}\n`;
      out += `SoRT Forum Attendees: ${attendeesLine(s)}\n`;
    }
    out += `${withStation(tpl.title || tpl.label || '', s)}\n\n`;
    out += 'Item\tDetails\n';
    scopeRows(ctx).forEach(r => { out += `${r.q.label}\t${linesText(r.lines.concat(r.pics.map(picText)))}\n`; });
    if (inc.followUps) openFollowUps(ctx, 'scope').forEach(f => { out += `Follow-up\t${f.owner}: ${f.text}${f.link ? ' ' + f.link.url : ''}\n`; });
    return out;
  }

  // ---- survey marks (under the map picture) --------------------------------------
  const MARK_COLS = [1.2, 3.0, 3.3, 3.5, 2.0, 3.0].map(wp);
  function shownMarks(s) {
    const hidden = new Set(s.map.hiddenMarks || []);
    return (s.map.marks || []).filter(m => !hidden.has(m.id));
  }
  function marksHtml(s) {
    const marks = shownMarks(s);
    if (!marks.length) return '';
    const th = (t, i) => `<td width="${MARK_COLS[i].px}" style="background:#e8e8e8;font-weight:bold;padding:4px 6px;${B}width:${MARK_COLS[i].cm}cm;">${t}</td>`;
    const tdm = (t, i) => `<td width="${MARK_COLS[i].px}" style="vertical-align:top;padding:4px 6px;${B}width:${MARK_COLS[i].cm}cm;">${t}</td>`;
    let rows = `<tr><td colspan="6"${wAttr()} style="background:#1f2d3d;color:#fff;font-weight:bold;padding:6px 8px;${B}${wStyle()}">${esc(stationLine(s) ? `State survey marks near ${stationLine(s)}` : 'State survey marks near the station')}</td></tr>`;
    rows += `<tr>${['', 'Mark', 'Type', 'Condition', 'From station', 'Coordinates'].map(th).join('')}</tr>`;
    marks.forEach(m => {
      const type = m.ahd != null ? `State benchmark · ${m.ahd} m AHD` : 'PSM (no AHD height)';
      const cond = [m.condition, m.lastVisit ? `last visited ${m.lastVisit}` : ''].filter(Boolean).join(', ');
      const mark = m.report ? `<a href="${esc(m.report)}">${esc(m.name)}</a>` : esc(m.name);
      rows += `<tr>${[esc(m.ref), mark, esc(type), esc(cond), esc(m.away || ''), esc(U().formatCoord(m.lat, m.lon))].map(tdm).join('')}</tr>`;
    });
    const t = `<table${wAttr()} style="border-collapse:collapse;table-layout:fixed;width:${FULL.cm}cm;font-family:Calibri,Arial,sans-serif;font-size:9pt;"><colgroup>${MARK_COLS.map(c => `<col style="width:${c.cm}cm;">`).join('')}</colgroup>${rows}</table>`;
    return t + `<p style="margin:2px 0 0;font-family:Calibri,Arial,sans-serif;font-size:8pt;color:#555;">State survey marks © State of Queensland (Department of Resources) — not the Bureau’s own station benchmarks. Click a mark for its Survey Control Mark Report.</p>`;
  }
  function marksText(s) {
    const marks = shownMarks(s);
    if (!marks.length) return '';
    return `${stationLine(s) ? `State survey marks near ${stationLine(s)}` : 'State survey marks near the station'}\n` + marks.map(m =>
      `${m.ref}\t${m.name}\t${m.ahd != null ? `State benchmark ${m.ahd} m AHD` : 'PSM'}\t${m.condition || ''}${m.lastVisit ? ', last visited ' + m.lastVisit : ''}\t${m.away || ''}\t${U().formatCoord(m.lat, m.lon)}\t${m.report || ''}`).join('\n') + '\n';
  }

  // ---- bridges on the map (BR1…), and who manages each ---------------------------
  // Only the bridges in the picture: the map keeps s.map.bridges to those.
  const BR_COLS = [1.2, 3.0, 4.0, 4.0, 1.8, 2.0].map(wp);
  const bridgeHead = s => (stationLine(s) ? `Bridges on the map — ${stationLine(s)}` : 'Bridges on the map');
  const BRIDGE_NOTE = 'Bridges © State of Queensland (Transport and Main Roads; Department of Natural Resources and Mines, Manufacturing and Regional and Rural Development): TMR’s register of State-controlled bridges and Queensland Roads and Tracks. A bridge not on TMR’s register is managed with the road it carries. Contacts from QLDTraffic’s road lookup. A guide to who to ask, not a permit.';
  function bridgesHtml(s) {
    const list = s.map.bridges || [];
    if (!list.length) return '';
    const th = (t, i) => `<td width="${BR_COLS[i].px}" style="background:#e8e8e8;font-weight:bold;padding:4px 6px;${B}width:${BR_COLS[i].cm}cm;">${t}</td>`;
    // A long address breaks inside its column (Word does so by itself; the preview needs telling).
    const tdm = (t, i) => `<td width="${BR_COLS[i].px}" style="vertical-align:top;padding:4px 6px;${B}width:${BR_COLS[i].cm}cm;overflow-wrap:anywhere;">${t}</td>`;
    let rows = `<tr><td colspan="6"${wAttr()} style="background:#4a1220;color:#fff;font-weight:bold;padding:6px 8px;${B}${wStyle()}">${esc(bridgeHead(s))}</td></tr>`;
    rows += `<tr>${['', 'Bridge', 'Managed by', 'Who to contact', 'From station', 'Coordinates'].map(th).join('')}</tr>`;
    list.forEach(b => {
      const c = b.contact;
      const contact = c ? [esc(c.name), c.phone ? esc(c.phone) : '', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''].filter(Boolean).join('<br>') : '—';
      rows += `<tr>${[esc(b.ref), `<b>${esc(b.title)}</b>${b.what ? `<br>${esc(b.what)}` : ''}`, `<b>${esc(b.who || '')}</b>${b.why ? `<br>${esc(b.why)}` : ''}`,
        contact, esc(b.away || ''), esc(U().formatCoord(b.lat, b.lon))].map(tdm).join('')}</tr>`;
    });
    const t = `<table${wAttr()} style="border-collapse:collapse;table-layout:fixed;width:${FULL.cm}cm;font-family:Calibri,Arial,sans-serif;font-size:9pt;"><colgroup>${BR_COLS.map(c => `<col style="width:${c.cm}cm;">`).join('')}</colgroup>${rows}</table>`;
    return t + `<p style="margin:2px 0 0;font-family:Calibri,Arial,sans-serif;font-size:8pt;color:#555;">${esc(BRIDGE_NOTE)}</p>`;
  }
  function bridgesText(s) {
    const list = s.map.bridges || [];
    if (!list.length) return '';
    return `${bridgeHead(s)}\n` + list.map(b => [b.ref, [b.title, b.what].filter(Boolean).join(' — '), [b.who, b.why].filter(Boolean).join(' — '),
      b.contact ? [b.contact.name, b.contact.phone, b.contact.email].filter(Boolean).join(', ') : '', b.away || '', U().formatCoord(b.lat, b.lon)].join('\t')).join('\n') + '\n';
  }

  // ---- the Bureau's benchmarks (HDB, via Flood-Net) ---------------------------
  // The first column holds BoM-TBM-1…: wide enough for it on one line.
  const BM_COLS = [1.9, 1.8, 2.0, 2.1, 5.2, 3.0].map(wp);
  function bureauHtml(s, b) {
    const BB = S.bureauBM;
    const th = (t, i) => `<td width="${BM_COLS[i].px}" style="background:#e8e8e8;font-weight:bold;padding:4px 6px;${B}width:${BM_COLS[i].cm}cm;">${t}</td>`;
    const tdm = (t, i) => `<td width="${BM_COLS[i].px}" style="vertical-align:top;padding:4px 6px;${B}width:${BM_COLS[i].cm}cm;">${t}</td>`;
    let rows = `<tr><td colspan="6"${wAttr()} style="background:#3b2f1d;color:#fff;font-weight:bold;padding:6px 8px;${B}${wStyle()}">${esc(stationLine(s) ? `Bureau benchmarks (HDB) — ${stationLine(s)}` : 'Bureau benchmarks (HDB)')}</td></tr>`;
    rows += `<tr>${['', 'Level (m)', 'Datum', 'On the gauge (LGH)', 'What it is and where', 'HDB comment'].map(th).join('')}</tr>`;
    b.marks.forEach(m => {
      rows += `<tr>${[esc(BB.label(m)), esc(BB.m3(m.level)), esc(BB.DATUM_TEXT[m.datum]), esc(m.onGauge != null ? BB.m3(m.onGauge) + ' m' : '—'), esc(m.description || ''), esc(m.comment || '')].map(tdm).join('')}</tr>`;
    });
    const t = `<table${wAttr()} style="border-collapse:collapse;table-layout:fixed;width:${FULL.cm}cm;font-family:Calibri,Arial,sans-serif;font-size:9pt;"><colgroup>${BM_COLS.map(c => `<col style="width:${c.cm}cm;">`).join('')}</colgroup>${rows}</table>`;
    return t + `<p style="margin:2px 0 0;font-family:Calibri,Arial,sans-serif;font-size:8pt;color:#555;">The station’s own benchmarks, from the Bureau’s HDB Benchmark Details${b.printedOn ? ` (${U().dmy(b.printedOn)})` : ''} via Flood-Net — not State survey marks. LGH: the level on the gauge’s scale, worked out only where the mark and the gauge zero share a datum.</p>`;
  }
  function bureauText(s, b) {
    const BB = S.bureauBM;
    return `${stationLine(s) ? `Bureau benchmarks (HDB) — ${stationLine(s)}` : 'Bureau benchmarks (HDB)'}\n` + b.marks.map(m =>
      `${BB.label(m)}\t${BB.m3(m.level)} m ${BB.DATUM_TEXT[m.datum]}\t${m.onGauge != null ? BB.m3(m.onGauge) + ' m on the gauge (LGH)' : ''}\t${m.description || ''}\t${m.comment || ''}`).join('\n') + '\n';
  }

  // ---- Property Services --------------------------------------------------------
  function psHtml(ctx) {
    const ps = ctx.defs.propertyServices, p = R().psState(ctx.session);
    const cell = `${wAttr(1)} style="padding:6px 8px;${B}vertical-align:top;${wStyle(1)}"`;
    const label = `${wAttr(0)} style="padding:6px 8px;${B}vertical-align:top;font-weight:bold;${wStyle(0)}"`;
    const answer = (...parts) => parts.filter(Boolean).map(escL).join('<br>');
    let rows = span(esc(withStation(ps.title, ctx.session)), 'background:#1f2d3d;color:#fff;font-weight:bold;padding:8px;');
    ps.rows.forEach(row => {
      if (!R().test(ctx, row.showIf)) return;
      const comment = String(p.comments[row.id] || '').trim();
      if (row.kind === 'coordGroup') {
        rows += span(esc(row.label), 'background:#e8e8e8;font-weight:bold;');
        (row.coords || []).forEach(c => {
          rows += `<tr><td ${label}>${esc(c.label)}</td><td ${cell}>${esc(R().psText(ctx, `${row.id}.${c.key}`, c.source, c.default))}</td></tr>`;
        });
        if (comment) rows += `<tr><td ${label}>Comment</td><td ${cell}>${escL(comment)}</td></tr>`;
      } else if (row.kind === 'question') {
        const detail = R().psDetail(ctx, row);
        rows += `<tr><td ${label}>${esc(row.label)}</td><td ${cell}>${answer(R().psQuestionLabel(ctx, row), detail && `${row.detail.label}: ${detail}`, comment)}</td></tr>`;
      } else if (row.kind === 'text') {
        rows += `<tr><td ${label}>${esc(row.label)}</td><td ${cell}>${answer(R().psNA(ctx, row) ? 'NA' : R().psText(ctx, row.id, row.source, ''), comment)}</td></tr>`;
      } else if (row.kind === 'sectionHeader') {
        rows += span(esc(row.label), 'background:#f0f0f0;font-style:italic;font-weight:bold;');
      } else if (row.kind === 'date') {
        rows += `<tr><td ${label}>${esc(row.label)}:</td><td ${cell}>${answer(R().psText(ctx, row.id, null, U().dmy(ctx.session.forum.date)), comment)}</td></tr>`;
      }
    });
    if (ctx.session.include.followUps) openFollowUps(ctx, 'ps').forEach(f => {
      rows += `<tr><td ${label.replace('font-weight:bold;', 'font-weight:bold;background:#fff2cc;')}>ACTION – ${esc(f.owner)}</td><td ${cell.replace('vertical-align:top;', 'vertical-align:top;background:#fff2cc;')}>${esc(f.text)}</td></tr>`;
    });
    if (p.general.trim()) rows += `<tr><td ${label}>Additional comments</td><td ${cell}>${escL(p.general.trim())}</td></tr>`;
    // The note is an instruction people must not miss: an
    // orange heading and a tinted, heavy-bordered box, its key sentence bold.
    if (ps.note) {
      rows += span('IMPORTANT NOTE', `background:#c55a11;color:#fff;font-weight:bold;${NOTE_B}`);
      rows += span(U().linkEmails(U().escEmph(ps.note)), `background:#fbe4d5;${NOTE_B}`);
    }
    return `${tableOpen()}${rows}</table>`;
  }
  function psText(ctx) {
    const ps = ctx.defs.propertyServices, p = R().psState(ctx.session);
    const answer = (...parts) => parts.filter(Boolean).map(U().flat).join('; ');
    let out = `${withStation(ps.title, ctx.session)}\n`;
    ps.rows.forEach(row => {
      if (!R().test(ctx, row.showIf)) return;
      const comment = String(p.comments[row.id] || '').trim();
      if (row.kind === 'coordGroup') {
        out += `${row.label}\n`;
        (row.coords || []).forEach(c => { out += `\t${c.label}\t${R().psText(ctx, `${row.id}.${c.key}`, c.source, c.default)}\n`; });
        if (comment) out += `\tComment\t${U().flat(comment)}\n`;
      } else if (row.kind === 'question') {
        const detail = R().psDetail(ctx, row);
        out += `${row.label}\t${answer(R().psQuestionLabel(ctx, row), detail && `${row.detail.label}: ${detail}`, comment)}\n`;
      } else if (row.kind === 'text') out += `${row.label}\t${answer(R().psNA(ctx, row) ? 'NA' : R().psText(ctx, row.id, row.source, ''), comment)}\n`;
      else if (row.kind === 'sectionHeader') out += `${row.label}\n`;
      else if (row.kind === 'date') out += `${row.label}:\t${answer(R().psText(ctx, row.id, null, U().dmy(ctx.session.forum.date)), comment)}\n`;
    });
    if (ctx.session.include.followUps) openFollowUps(ctx, 'ps').forEach(f => { out += `ACTION – ${f.owner}\t${f.text}\n`; });
    if (p.general.trim()) out += `Additional comments\t${U().flat(p.general)}\n`;
    if (ps.note) out += `IMPORTANT NOTE\n${U().unEmph(ps.note)}\n`;
    return out;
  }

  // ---- the whole copy ----------------------------------------------------------------
  // picture: {dataUrl} or null — made by the map (map.js) before this is called.
  function build(ctx, picture) {
    const s = ctx.session, inc = s.include;
    let html = scopeHtml(ctx), text = scopeText(ctx);
    if (inc.map && picture && picture.dataUrl) {
      // Centred, like the tables: align= for Word's paste, text-align for the preview.
      html += GAP + `<div align="center" style="text-align:center;"><img src="${picture.dataUrl}" alt="Site map" style="width:16cm;max-width:100%;height:auto;border:1px solid #999;"></div>`;
      text += '\n\n[Site map image included]\n';
      // A long relocation's close-ups: side by side under the map, the same 16 cm across.
      const cu = picture.closeups || [];
      if (cu.length) {
        html += `<table align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px auto 0;"><tr>${cu.map(c =>
          `<td style="padding:0 3px;border:none;vertical-align:top;"><img src="${c.dataUrl}" alt="${esc(c.label)}" style="width:${(16 / cu.length - 0.2).toFixed(1)}cm;height:auto;border:1px solid #999;"></td>`).join('')}</tr></table>`;
        text += `[Close-up maps included: ${cu.map(c => c.label).join('; ')}]\n`;
      }
    }
    // State survey marks: a water level table's only (they tie its gauge to AHD).
    if (inc.map && inc.marks && ctx.waterLevel) {
      const mh = marksHtml(s);
      if (mh) { html += GAP + mh; text += '\n' + marksText(s); }
    }
    if (inc.map && inc.bridges !== false && picture && picture.dataUrl) {
      const bh = bridgesHtml(s);
      if (bh) { html += GAP + bh; text += '\n' + bridgesText(s); }
    }
    const bb = inc.bureauBM !== false && S.bureauBM ? S.bureauBM.forWord(s) : null;
    if (bb) { html += GAP + bureauHtml(s, bb); text += '\n' + bureauText(s, bb); }
    if (inc.ps) { html += GAP + psHtml(ctx); text += '\n\n' + psText(ctx); }
    return { html, text };
  }

  async function toClipboard(html, text) {
    try {
      if (navigator.clipboard && G.ClipboardItem) {
        await navigator.clipboard.write([new G.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
        return 'rich';
      }
    } catch (_) { /* fall through to the older route */ }
    try {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:-9999px;top:0;';
      box.innerHTML = html;
      document.body.appendChild(box);
      const range = document.createRange(); range.selectNodeContents(box);
      const sel = G.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      const ok = document.execCommand('copy');
      sel.removeAllRanges(); box.remove();
      if (ok) return 'rich';
    } catch (_) { /* fall through */ }
    await navigator.clipboard.writeText(text);
    return 'plain';
  }

  S.word = { build, scopeHtml, psHtml, marksHtml, bridgesHtml, toClipboard, stationLine, WORD_TABLE_CM };
})(typeof window !== 'undefined' ? window : globalThis);
