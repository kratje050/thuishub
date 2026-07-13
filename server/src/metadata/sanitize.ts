const ENTITIES: Record<string,string> = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ' };

export function decodeHtmlEntities(value:string){
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(_match,entity:string)=>{
    if(entity.startsWith('#x'))return String.fromCodePoint(Number.parseInt(entity.slice(2),16));
    if(entity.startsWith('#'))return String.fromCodePoint(Number.parseInt(entity.slice(1),10));
    return ENTITIES[entity.toLowerCase()]??'';
  });
}

export function sanitizeExternalText(value:unknown,maxLength=20_000){
  if(typeof value!=='string')return'';
  const withoutExecutable=value.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
  return decodeHtmlEntities(withoutExecutable.replace(/<[^>]*>/g,' '))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,maxLength);
}

export function safeStringArray(value:unknown,limit=100){
  const list=Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
  return [...new Set(list.map(item=>sanitizeExternalText(item,250)).filter(Boolean))].slice(0,limit);
}

export function parseFiniteNumber(value:unknown){
  const parsed=typeof value==='number'?value:Number.parseFloat(String(value??'').replace(',','.'));
  return Number.isFinite(parsed)?parsed:undefined;
}

export function parseYear(value:unknown){
  const match=String(value??'').match(/(?:19|20)\d{2}/);return match?Number(match[0]):undefined;
}
