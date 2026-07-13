import type { MetadataConfidence, MetadataRecord, MetadataSearchQuery } from './types.js';

export function normalizeMetadataTitle(value:string){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl').replace(/\b(2160p|1080p|720p|480p|hdr|dv|bluray|webrip|web-dl|x26[45]|hevc|avc|remux|proper|repack)\b.*$/i,'').replace(/[^a-z0-9]+/g,' ').trim()}

function levenshtein(a:string,b:string){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=old}}return row[b.length]}
export function titleSimilarity(a:string,b:string){const left=normalizeMetadataTitle(a),right=normalizeMetadataTitle(b);if(!left||!right)return 0;if(left===right)return 1;return 1-levenshtein(left,right)/Math.max(left.length,right.length)}

export function rankMetadataMatches(query:MetadataSearchQuery,candidates:MetadataRecord[]){
  const ranked=candidates.map(item=>{const similarity=Math.max(titleSimilarity(query.title,item.title),item.originalTitle?titleSimilarity(query.title,item.originalTitle):0);const yearMatch=Boolean(query.year&&item.year&&query.year===item.year);const yearConflict=Boolean(query.year&&item.year&&Math.abs(query.year-item.year)>1);const externalMatch=Boolean(query.imdbId&&item.externalIds.imdb===query.imdbId||query.tvmazeId&&item.externalIds.tvmaze===query.tvmazeId||query.thetvdbId&&item.externalIds.thetvdb===query.thetvdbId);const score=externalMatch?1:Math.max(0,similarity+(yearMatch?.08:0)-(yearConflict?.2:0));return{item,score,similarity,yearMatch,externalMatch}}).sort((a,b)=>b.score-a.score);
  return ranked;
}

export function chooseMetadataMatch(query:MetadataSearchQuery,candidates:MetadataRecord[]):{match:MetadataRecord|null;confidence:MetadataConfidence;reason:string;ranked:ReturnType<typeof rankMetadataMatches>}{
  const ranked=rankMetadataMatches(query,candidates);if(!ranked.length)return{match:null,confidence:'none',reason:'Geen resultaat gevonden.',ranked};const best=ranked[0],second=ranked[1];
  const bestTitle=normalizeMetadataTitle(best.item.title);const sameNamedSeries=query.mediaType==='series'&&ranked.filter(item=>normalizeMetadataTitle(item.item.title)===bestTitle).length>1;const ambiguous=sameNamedSeries||Boolean(second&&Math.abs(best.score-second.score)<.03&&bestTitle===normalizeMetadataTitle(second.item.title));
  if(best.externalMatch)return{match:best.item,confidence:'very_certain',reason:'Exacte externe ID.',ranked};
  if(best.similarity===1&&best.yearMatch&&!ambiguous)return{match:best.item,confidence:'very_certain',reason:'Exacte titel en exact jaar.',ranked};
  if(best.similarity>=.96&&!ambiguous&&!query.year)return{match:best.item,confidence:'probable',reason:'Zeer vergelijkbare unieke titel zonder jaartal.',ranked};
  if(best.similarity>=.88&&!ambiguous)return{match:best.item,confidence:'probable',reason:'Waarschijnlijke overeenkomst; handmatige controle aanbevolen.',ranked};
  return{match:null,confidence:'review',reason:ambiguous?'Meerdere gelijknamige resultaten gevonden.':'Geen overeenkomst met voldoende zekerheid.',ranked};
}
