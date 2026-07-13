# Kwaliteitsprofielen

| Profiel | Limiet | Maximale resolutie |
|---|---:|---:|
| Origineel | Geen gebruikerslimiet | Apparaatlimiet |
| 4K Maximum | 80 Mbps | 2160p |
| 4K Hoog | 40 Mbps | 2160p |
| 4K Gebalanceerd | 25 Mbps | 2160p |
| 1080p Maximum | 20 Mbps | 1080p |
| 1080p Hoog | 12 Mbps | 1080p |
| 1080p Gebalanceerd | 8 Mbps | 1080p |
| 720p | 4 Mbps | 720p |
| Databesparing | 2 Mbps | 480p |

Automatisch gebruikt maximaal 80% van de gemelde beschikbare bandbreedte en respecteert apparaatbitrate/resolutie. De gebruiker kan tijdens browserplayback wisselen; de server maakt dan een nieuw passend HLS-profiel. Er zijn aparte standaardkeuzes voor LAN, Tailscale, mobiel, downloads en Live TV.

De huidige HLS-uitvoer is één gekozen variant per sessie, niet een masterplaylist met gelijktijdige 2160p/1440p/1080p/720p/480p-varianten. Daardoor vindt kwaliteitswisseling gecontroleerd door de UI plaats en niet volledig bufferadaptief binnen één HLS-sessie.
