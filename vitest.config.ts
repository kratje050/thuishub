import { defineConfig } from 'vitest/config';

// De servertests gebruiken per testbestand een eigen tijdelijke datamap via
// process.env. Worker-threads delen die variabelen, dus voer bestanden bewust
// na elkaar uit om kruislings migreren of verwijderen van testdata te voorkomen.
export default defineConfig({test:{fileParallelism:false}});
