<script setup>
import { Link, usePage } from "@inertiajs/vue3";
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  CookingPot,
  Leaf,
  LayoutDashboard,
  Settings,
} from "@lucide/vue";

const page = usePage();
const nav = [
  ["/", "Heute", LayoutDashboard],
  ["/diary", "Tagebuch", BookOpen],
  ["/recipes", "Rezepte", CookingPot],
  ["/calendar", "Kalender", CalendarDays],
  ["/insights", "Muster", ChartNoAxesCombined],
  ["/foods", "FODMAP", Leaf],
];
const reload = () => window.location.reload();
</script>

<template>
  <div class="app-shell min-h-screen bg-bauch-paper text-bauch-ink antialiased">
    <header
      class="mobile-header border-b border-bauch-line/80 bg-bauch-paper/95 shadow-sm backdrop-blur"
    >
      <Link href="/" class="brand font-display tracking-[-0.04em]">
        <span class="brand-icon"><Leaf :size="19" /></span
        ><span>Bauchgefühl</span><span class="brand-dot">.</span></Link
      >
      <span class="header-caption tracking-wide">Dein privates Tagebuch</span>
      <Link
        href="/profile"
        class="header-settings"
        aria-label="Profil und Zyklus"
      >
        <Settings :size="18" />
      </Link>
    </header>

    <main class="main mx-auto w-full">
      <div v-if="page.props.loadError" role="alert" class="alert error">
        {{ page.props.loadError }} <button @click="reload">Erneut laden</button>
      </div>
      <div class="page-content"><slot /></div>
    </main>

    <nav
      class="bottom-nav border-bauch-line/80 bg-bauch-paper/95 shadow-[0_-8px_28px_rgba(41,55,47,0.06)] backdrop-blur"
      aria-label="Hauptnavigation"
    >
      <Link
        v-for="[href, label, Icon] in nav"
        :key="href"
        :href="href"
        :class="['bottom-link', { active: page.url.split('?')[0] === href }]"
        :aria-current="page.url.split('?')[0] === href ? 'page' : undefined"
      >
        <component :is="Icon" :size="19" />
        <span>{{ label }}</span>
      </Link>
    </nav>
  </div>
</template>
