<script setup>
import { Link, usePage } from "@inertiajs/vue3";
import {
  LayoutDashboard,
  BookOpen,
  CookingPot,
  ChartNoAxesCombined,
  Leaf,
  ArrowUpRight,
  Heart,
  Download,
} from "lucide-vue-next";
const page = usePage();
const reload = () => window.location.reload();
const nav = [
  ["/", "Übersicht", LayoutDashboard],
  ["/diary", "Mein Tagebuch", BookOpen],
  ["/recipes", "Meine Rezepte", CookingPot],
  ["/insights", "Meine Muster", ChartNoAxesCombined],
  ["/foods", "FODMAP-Lexikon", Leaf],
];
</script>
<template>
  <div class="layout">
    <aside class="sidebar">
      <Link href="/" class="brand"
        ><span class="brand-icon"><Leaf :size="23" /></span>Bauchgefühl<span
          class="brand-dot"
          >.</span
        ></Link
      >
      <p class="sidebar-label">DEIN PERSÖNLICHER KOMPASS</p>
      <nav aria-label="Hauptnavigation">
        <Link
          v-for="[href, label, Icon] in nav"
          :key="href"
          :href="href"
          :class="['nav-link', { active: page.url.split('?')[0] === href }]"
          :aria-current="page.url.split('?')[0] === href ? 'page' : undefined"
          ><component :is="Icon" :size="19" />{{ label
          }}<span v-if="page.url.split('?')[0] === href" class="nav-dot"
        /></Link>
      </nav>
      <div class="sidebar-bottom">
        <div class="gentle-note">
          <Heart :size="20" /><strong
            >Kleine Schritte.<br />Ein besseres Bauchgefühl.</strong
          >
          <p>
            Auch gute Tage erzählen etwas. Halte fest, wenn es dir gut geht.
          </p>
        </div>
        <a class="export-link" href="/api/export"
          ><Download :size="16" /> Tagebuch exportieren</a
        >
        <div class="profile">
          <span>Du</span>
          <div>
            <strong>Dein privates Tagebuch</strong
            ><small>Lokal auf deinem Gerät</small>
          </div>
        </div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span>Ernährung verstehen. Wohlbefinden entdecken.</span
        ><span class="local-status"><i /> Persönlicher Bereich</span>
      </header>
      <div v-if="page.props.loadError" role="alert" class="alert error">
        {{ page.props.loadError }} <button @click="reload">Erneut laden</button>
      </div>
      <div class="page-content"><slot /></div>
      <footer>
        Deine Beobachtungen zählen. Muster sind Hinweise, keine Diagnose.<a
          href="https://www.monashfodmap.com/about-fodmap-and-ibs/high-and-low-fodmap-foods/"
          target="_blank"
          rel="noreferrer"
          >Über FODMAPs <ArrowUpRight :size="13"
        /></a>
      </footer>
    </main>
  </div>
</template>
