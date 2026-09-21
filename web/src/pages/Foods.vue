<script setup>
import { ref, computed } from "vue";
import { Head } from "@inertiajs/vue3";
import { Search, Leaf, ArrowUpRight } from "lucide-vue-next";
import AppShell from "../components/AppShell.vue";
defineProps({ foods: Array });
const search = ref(""),
  level = ref("all");
function matches(f) {
  return (
    (level.value === "all" || f.level === level.value) &&
    (f.name + " " + f.aliases.join(" ") + " " + f.groups.join(" "))
      .toLowerCase()
      .includes(search.value.toLowerCase())
  );
}
</script>
<template>
  <Head title="FODMAP-Lexikon" /><AppShell
    ><div class="page-heading">
      <div>
        <p class="eyebrow">LEBENSMITTEL BESSER VERSTEHEN</p>
        <h1>Das kleine FODMAP-Lexikon</h1>
        <p>
          Eine erste Orientierung für deine Zutaten – mit Raum für individuelle
          Unterschiede.
        </p>
      </div>
      <Leaf :size="36" class="muted" />
    </div>
    <div class="notice">
      <strong>Die Portion macht einen Unterschied.</strong>
      <p>
        Diese Liste zeigt allgemeine Beispiele, keine getesteten
        Portionsgrenzen. Sorte, Zubereitung und Menge verändern den
        FODMAP-Gehalt. FODMAP-arm bedeutet nicht allergenfrei oder für dich
        garantiert verträglich.
      </p>
      <a
        href="https://www.monashfodmap.com/about-fodmap-and-ibs/high-and-low-fodmap-foods/"
        target="_blank"
        rel="noreferrer"
        >Quelle & aktuelle Portionsinformationen: Monash University
        <ArrowUpRight :size="14"
      /></a>
    </div>
    <div class="toolbar">
      <div class="search-box grow">
        <Search :size="18" /><input
          aria-label="Lebensmittel suchen"
          v-model="search"
          placeholder="Lebensmittel, deutsche Bezeichnung oder FODMAP suchen …"
        />
      </div>
      <label
        >Referenz<select v-model="level">
          <option value="all">Alle Lebensmittel</option>
          <option value="lower">Eher FODMAP-arm</option>
          <option value="higher">Eher FODMAP-reich</option>
          <option value="unknown">Nicht bewertet</option>
        </select></label
      >
    </div>
    <div class="panel food-table">
      <table>
        <thead>
          <tr>
            <th>Lebensmittel</th>
            <th>Kategorie</th>
            <th>Allgemeine Einordnung</th>
            <th>FODMAP-Gruppen</th>
            <th>Quelle</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in foods.filter(matches)" :key="f.id">
            <td>
              <strong>{{ f.name }}</strong>
            </td>
            <td>{{ f.category }}</td>
            <td>
              <span
                class="pill"
                :class="
                  f.level === 'higher'
                    ? 'high'
                    : f.level === 'lower'
                      ? 'low'
                      : 'neutral'
                "
                >{{
                  f.level === "higher"
                    ? "Eher reich"
                    : f.level === "lower"
                      ? "Eher arm"
                      : "Nicht bewertet"
                }}</span
              >
            </td>
            <td>{{ f.groups.join(", ") || "Keine Angabe" }}</td>
            <td>
              <a
                v-if="f.source"
                :href="f.source"
                target="_blank"
                rel="noreferrer"
                :aria-label="'Quelle für ' + f.name"
                ><ArrowUpRight :size="16" /></a
              ><span v-else>–</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="empty-state" v-if="!foods.filter(matches).length">
        <h3>Kein passender Eintrag.</h3>
        <p>
          Unbekannte Lebensmittel werden nicht automatisch als FODMAP-arm
          eingestuft.
        </p>
      </div>
    </div>
    <p class="helper">
      Referenzstand 21. September 2026 · Begrenzte Auswahl, keine vollständige
      Lebensmitteldatenbank. Gewürze ohne Bewertung können trotzdem im Tagebuch
      verglichen werden.
    </p>
  </AppShell>
</template>
