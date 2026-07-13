import type { MetadataProviderId } from './types.js';
import { cachedProviderPayload, recordProviderResult, refreshCachedProviderPayload, storeProviderPayload } from './store.js';
import { APP_VERSION } from '../constants.js';

type RequestOptions={provider:MetadataProviderId;url:URL;cacheKey:string;fetcher?:typeof fetch;sleep?:(ms:number)=>Promise<void>;timeoutMs?:number;maxBytes?:number;retries?:number;force?:boolean};
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

function safeErrorMessage(provider:MetadataProviderId,error:unknown){
  const text=error instanceof Error?error.message:String(error);return `${provider}: ${text}`.replace(/apikey=[^&\s]+/gi,'apikey=***').slice(0,500);
}

async function readLimitedJson(response:Response,maxBytes:number){
  const declared=Number(response.headers.get('content-length')||0);if(declared>maxBytes)throw new Error('Providerresponse is te groot.');
  const reader=response.body?.getReader();if(!reader)return response.json();
  const chunks:Uint8Array[]=[];let total=0;
  while(true){const{done,value}=await reader.read();if(done)break;if(value){total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error('Providerresponse is te groot.')}chunks.push(value)}}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new Error('Provider gaf een ongeldige JSON-response.')}
}

export async function requestProviderJson<T=any>(options:RequestOptions):Promise<T>{
  const cached=!options.force?cachedProviderPayload(options.provider,options.cacheKey):null;
  if(cached){recordProviderResult(options.provider,{cacheHit:true});return cached.payload as T}
  const stale=cachedProviderPayload(options.provider,options.cacheKey,true);
  recordProviderResult(options.provider,{cacheMiss:true});
  const fetcher=options.fetcher||fetch;const sleeper=options.sleep||wait;const maxBytes=options.maxBytes||2_000_000;const retries=Math.max(0,Math.min(2,options.retries??2));
  for(let attempt=0;attempt<=retries;attempt++){
    const headers:Record<string,string>={accept:'application/json','user-agent':`ThuisHub/${APP_VERSION}`};
    if(stale?.etag)headers['if-none-match']=stale.etag;if(stale?.lastModified)headers['if-modified-since']=stale.lastModified;
    try{
      const response=await fetcher(options.url,{headers,redirect:'error',signal:AbortSignal.timeout(options.timeoutMs||10_000)});
      if(response.status===304&&stale){refreshCachedProviderPayload(options.provider,options.cacheKey);recordProviderResult(options.provider,{success:true});return stale.payload as T}
      if(response.status===429){
        const seconds=Math.max(1,Math.min(30,Number(response.headers.get('retry-after')||2**attempt)));const until=new Date(Date.now()+seconds*1000).toISOString();
        recordProviderResult(options.provider,{error:'Tijdelijke limiet van metadata-provider bereikt.',rateLimitedUntil:until});
        if(attempt<retries){await sleeper(seconds*1000);continue}throw Object.assign(new Error('Tijdelijke limiet van metadata-provider bereikt.'),{status:429});
      }
      if(!response.ok)throw Object.assign(new Error(`Provider gaf HTTP ${response.status}.`),{status:response.status});
      const payload=await readLimitedJson(response,maxBytes);storeProviderPayload(options.provider,options.cacheKey,payload,response.headers);recordProviderResult(options.provider,{success:true});return payload as T;
    }catch(error){
      const message=safeErrorMessage(options.provider,error);if((error as any)?.status===429)throw error;
      if(attempt<retries&&(['AbortError','TimeoutError'].includes((error as any)?.name)||Number((error as any)?.status)>=500)){await sleeper(Math.min(4000,500*2**attempt));continue}
      recordProviderResult(options.provider,{error:message});throw new Error(message);
    }
  }
  throw new Error(`${options.provider}: providerverzoek is mislukt.`);
}

export function redactedProviderUrl(url:URL){const safe=new URL(url);if(safe.searchParams.has('apikey'))safe.searchParams.set('apikey','***');return safe.toString()}

export const httpInternals={readLimitedJson,safeErrorMessage};
