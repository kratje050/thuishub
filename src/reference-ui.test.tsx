import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BottomStatusBar, QualityBadges, Sidebar, formatBytes, formatUptime, isNavigationActive, qualityBadges, searchMedia, type ReferenceView } from './reference-ui';
import type { MediaItem } from './api';

function media(overrides:Partial<MediaItem>={}):MediaItem{
  return {id:1,kind:'movie',title:'Interstellar',size:1,hasSubtitle:true,directPlay:true,genres:['Sci-Fi'],state:{favorite:false,watchlist:false,watched:false},...overrides};
}

describe('referentie-interface',()=>{
  it('bevat de gevraagde navigatie zonder verkoop- of promotietekst',()=>{
    const html=renderToStaticMarkup(<Sidebar view="home" serverName="ThuisHub" isAdmin open={false} onNavigate={()=>{}} onClose={()=>{}}/>);
    expect(html).toContain('Home');
    expect(html).toContain('Bibliotheek');
    expect(html).toContain('Verder kijken');
    expect(html).toContain('Apparaten');
    expect(html).not.toMatch(/ThuisHub Premium|\bPremium\b|upgraden|abonnement|donatie/i);
    expect(html).toContain('sidebar-cinema-glow');
    expect(html).not.toContain('sidebar-card');
  });

  it('verbergt beheeronderdelen voor een normaal profiel',()=>{
    const html=renderToStaticMarkup(<Sidebar view="home" serverName="ThuisHub" isAdmin={false} open={false} onNavigate={()=>{}} onClose={()=>{}}/>);
    expect(html).not.toContain('Dashboard');
    expect(html).not.toContain('Apparaten');
  });

  it('markeert alle bibliotheekonderdelen onder dezelfde actieve route',()=>{
    const libraryViews:ReferenceView[]=['movies','series','music','photos','watchlist'];
    for(const view of libraryViews)expect(isNavigationActive(view,'movies')).toBe(true);
    expect(isNavigationActive('live','movies')).toBe(false);
  });

  it('zoekt op titel, serie, originele titel en echte castgegevens',()=>{
    const items=[media({id:1,title:'Interstellar',cast:[{name:'Matthew McConaughey'}]}),media({id:2,title:'Aflevering 1',kind:'episode',seriesTitle:'Dune: Prophecy',originalTitle:'The Hidden Hand'})];
    expect(searchMedia(items,'matthew')).toHaveLength(1);
    expect(searchMedia(items,'prophecy')[0].id).toBe(2);
    expect(searchMedia(items,'hidden hand')[0].id).toBe(2);
  });

  it('toont alleen kwaliteitslabels die uit mediadata volgen',()=>{
    expect(qualityBadges(media({height:2160,hdrType:'hdr10',atmos:true,audioChannels:8}))).toEqual(['4K','HDR10','Atmos']);
    expect(qualityBadges(media({height:1080,audioChannels:6}))).toEqual(['HD','5.1']);
    expect(qualityBadges(media())).toEqual([]);
    expect(renderToStaticMarkup(<QualityBadges item={media()}/>)).toBe('');
  });

  it('gebruikt nette systeemformattering en verzint geen netwerksnelheid',()=>{
    expect(formatBytes(1_099_511_627_776)).toBe('1.00 TB');
    expect(formatUptime(183900)).toBe('2d 3u 5m');
    const html=renderToStaticMarkup(<BottomStatusBar data={{version:'1.2.4',uptimeSeconds:60,system:{platform:{name:'Windows',release:'11'},cpu:{usagePercent:12},memory:{usagePercent:28},network:{available:false}}}} history={{cpu:[12],memory:[28],download:[],upload:[]}}/>);
    expect(html).toContain('Netwerk onbekend');
    expect(html).not.toMatch(/125 Mbps|42 Mbps/);
  });

  it('bevat het centrale donkere thema, bewegingsreductie en een minimale tekstgrootte',()=>{
    const theme=readFileSync('src/theme.css','utf8');
    const styles=readFileSync('src/reference-ui.css','utf8');
    expect(theme).toContain('--app-background:#020a11');
    expect(theme).toContain('--lime-primary:#b8ff2c');
    expect(styles).toContain('@media(prefers-reduced-motion:reduce)');
    expect(styles).toContain('#root small,#root em,#root kbd{font-size:11px!important}');
  });
});
