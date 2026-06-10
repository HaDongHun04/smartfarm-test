// ════════════════════════════════════════════════════════════════
//  HDH 스마트팜 매크로 컴파일러 (브라우저 전용)
//  텍스트 매크로 → 바이트코드(hex 문자열). R4는 이 hex만 받아 저장·실행.
//  같은 폴더에 두고 index.html에서 동적 import 하여 사용.
//    const { compileMacro } = await import('./compiler.js');
// ════════════════════════════════════════════════════════════════

// opcode (R4 펌웨어와 반드시 일치)
export const OP = {
  ON: 0x01, OFF: 0x02, TOGGLE: 0x03,
  DELAYMS: 0x04, DELAYSEC: 0x05, WAITUNTIL: 0x06,
  LCD: 0x07, LCDCLEAR: 0x08, PRINT: 0x09, PUB: 0x0A,
  LOOP: 0x0B, ENDLOOP: 0x0C, END: 0xFF,
};

export const MACRO_POOL_SIZE = 2048;  // R4와 동일
const MAX_CH = 28;

// 텍스트 → { ok, bytes:Uint8Array, hex, error }
export function compileMacro(src, maxCh = MAX_CH) {
  const out = [];
  const emit = (b) => out.push(b & 0xFF);
  const emitStr = (s) => { emit(s.length); for (const c of s) emit(c.charCodeAt(0)); };

  const lines = String(src).split('\n');
  let loopDepth = 0;

  for (let li = 0; li < lines.length; li++) {
    let ln = lines[li].trim();
    if (!ln || ln.startsWith('#')) continue;
    const sp = ln.indexOf(' ');
    const cmd = (sp < 0 ? ln : ln.slice(0, sp)).toLowerCase();
    const arg = (sp < 0 ? '' : ln.slice(sp + 1)).trim();
    const L = li + 1;
    const fail = (m) => ({ ok: false, error: `${L}행: ${m}` });

    switch (cmd) {
      case 'on': case 'off': case 'toggle': {
        const ch = parseInt(arg, 10);
        if (!(ch >= 1 && ch <= maxCh)) return fail(`채널 1~${maxCh}`);
        emit(cmd === 'on' ? OP.ON : cmd === 'off' ? OP.OFF : OP.TOGGLE);
        emit(ch - 1);
        break;
      }
      case 'delayms': case 'delaysec': {
        const v = parseInt(arg, 10);
        if (!(v >= 0 && v <= 65535)) return fail('값 0~65535');
        emit(cmd === 'delayms' ? OP.DELAYMS : OP.DELAYSEC);
        emit(v & 0xFF); emit((v >> 8) & 0xFF);
        break;
      }
      case 'waituntil': {
        const parts = arg.split(/\s+/);
        const h = parseInt(parts[0], 10), m = parseInt(parts[1] || '0', 10);
        if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return fail('시 0~23, 분 0~59');
        emit(OP.WAITUNTIL); emit(h); emit(m);
        break;
      }
      case 'lcd': {
        const s2 = arg.indexOf(' ');
        if (s2 < 0) return fail('lcd <행> <텍스트>');
        const row = parseInt(arg.slice(0, s2), 10);
        let txt = arg.slice(s2 + 1);
        if (!(row >= 0 && row <= 3)) return fail('행 0~3');
        if (txt.length > 20) txt = txt.slice(0, 20);
        emit(OP.LCD); emit(row); emitStr(txt);
        break;
      }
      case 'lcdclear': emit(OP.LCDCLEAR); break;
      case 'print': {
        let t = arg; if (t.length > 60) t = t.slice(0, 60);
        emit(OP.PRINT); emitStr(t);
        break;
      }
      case 'pub': {
        const s2 = arg.indexOf(' ');
        if (s2 < 0) return fail('pub <토픽> <메시지>');
        let tp = arg.slice(0, s2), pl = arg.slice(s2 + 1);
        if (tp.length > 40) tp = tp.slice(0, 40);
        if (pl.length > 40) pl = pl.slice(0, 40);
        emit(OP.PUB); emitStr(tp); emitStr(pl);
        break;
      }
      case 'loop': {
        const c = parseInt(arg, 10);
        if (!(c >= 1 && c <= 255)) return fail('loop 1~255');
        if (loopDepth >= 4) return fail('loop 중첩 최대 4');
        loopDepth++;
        emit(OP.LOOP); emit(c);
        break;
      }
      case 'endloop': {
        if (loopDepth <= 0) return fail('endloop 짝 없음');
        loopDepth--;
        emit(OP.ENDLOOP);
        break;
      }
      case 'end': li = lines.length; break;  // 종료
      default: return fail(`알 수 없는 명령 '${cmd}'`);
    }
    if (out.length > MACRO_POOL_SIZE) return fail('바이트코드가 너무 깁니다');
  }
  if (loopDepth !== 0) return { ok: false, error: 'loop/endloop 짝이 안 맞습니다' };
  emit(OP.END);

  const bytes = Uint8Array.from(out);
  const hex = out.map(b => b.toString(16).padStart(2, '0')).join('');
  return { ok: true, bytes, hex, size: out.length };
}

// 바이트코드(hex) → 텍스트 (역어셈블, 디버그/확인용)
export function disassemble(hex) {
  const b = [];
  for (let i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  let i = 0; const lines = [];
  const str = (len) => { let s = ''; for (let k = 0; k < len; k++) s += String.fromCharCode(b[i++]); return s; };
  while (i < b.length) {
    const op = b[i++];
    if (op === OP.ON) lines.push(`on ${b[i++] + 1}`);
    else if (op === OP.OFF) lines.push(`off ${b[i++] + 1}`);
    else if (op === OP.TOGGLE) lines.push(`toggle ${b[i++] + 1}`);
    else if (op === OP.DELAYMS) { const v = b[i] | (b[i+1] << 8); i += 2; lines.push(`delayms ${v}`); }
    else if (op === OP.DELAYSEC) { const v = b[i] | (b[i+1] << 8); i += 2; lines.push(`delaysec ${v}`); }
    else if (op === OP.WAITUNTIL) { const h = b[i++], m = b[i++]; lines.push(`waituntil ${h} ${m}`); }
    else if (op === OP.LCD) { const r = b[i++], len = b[i++]; lines.push(`lcd ${r} ${str(len)}`); }
    else if (op === OP.LCDCLEAR) lines.push('lcdclear');
    else if (op === OP.PRINT) { const len = b[i++]; lines.push(`print ${str(len)}`); }
    else if (op === OP.PUB) { const tl = b[i++]; const t = str(tl); const pl = b[i++]; const p = str(pl); lines.push(`pub ${t} ${p}`); }
    else if (op === OP.LOOP) lines.push(`loop ${b[i++]}`);
    else if (op === OP.ENDLOOP) lines.push('endloop');
    else if (op === OP.END) break;
    else { lines.push(`# unknown 0x${op.toString(16)}`); break; }
  }
  return lines.join('\n');
}
