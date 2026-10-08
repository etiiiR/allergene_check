<script setup>
import { computed } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  CookingPot,
  Leaf,
  LayoutDashboard,
  Settings,
  FileText,
  Activity,
} from "@lucide/vue";
import ToastHost from "./ui/ToastHost.vue";
import { workspace } from "../ui/workspace";
import { useVaultDiary } from "../privacy/vault-session.js";
const page = usePage();
const diary = useVaultDiary();
const nav = [
  ["/", "Heute", LayoutDashboard],
  ["/diary", "Tagebuch", BookOpen],
  ["/calendar", "Kalender", CalendarDays],
  ["/recipes", "Rezepte", CookingPot],
  ["/insights", "Muster", ChartNoAxesCombined],
];
const extra = [
  ["/foods", "FODMAP", Leaf],
  ["/report", "Arztbericht", FileText],
  ["/profile", "Profil und Zyklus", Settings],
];
const path = computed(() => page.url.split("?")[0]);
const currentLabel = computed(
  () =>
    [...nav, ...extra].find(([url]) => path.value === url)?.[1] || "Tagebuch",
);
const reload = () => window.location.reload();
</script>
<template>
  <div class="app-shell" data-theme="bauch">
    <a href="#main-content" class="skip-link">Zum Inhalt</a>
    <aside class="desktop-sidebar no-print">
      <Link href="/" class="brand"
        ><span class="brand-icon"><Activity :size="19" /></span
        >Bauchgefühl</Link
      >
      <p class="nav-caption">DEIN TAGEBUCH</p>
      <nav aria-label="Hauptnavigation" class="side-nav">
        <Link
          v-for="[href, label, Icon] in nav"
          :key="href"
          :href="href"
          :class="{ active: path === href }"
          :aria-current="path === href ? 'page' : undefined"
          ><component :is="Icon" :size="18" />{{ label }}</Link
        >
      </nav>
      <div class="sidebar-bottom">
        <p class="nav-caption">NACHSCHLAGEN & TEILEN</p>
        <nav aria-label="Weitere Seiten" class="side-nav">
          <Link
            v-for="[href, label, Icon] in extra"
            :key="href"
            :href="href"
            :class="{ active: path === href }"
            :aria-current="path === href ? 'page' : undefined"
            ><component :is="Icon" :size="18" />{{ label }}</Link
          >
        </nav>
        <p class="sidebar-note">Deine Beobachtungen.<br />In deinem Tempo.</p>
      </div>
    </aside>
    <div class="app-body">
      <header class="mobile-header no-print">
        <Link href="/" class="brand mobile-brand"
          ><span class="brand-icon"><Activity :size="18" /></span
          >Bauchgefühl</Link
        >
        <span class="desktop-breadcrumb"
          >Tagebuch <span>/</span> {{ currentLabel }}</span
        >
        <details class="header-more">
          <summary aria-label="Weitere Seiten">
            Mehr <span aria-hidden="true">⌄</span>
          </summary>
          <nav aria-label="Weitere Seiten">
            <Link v-for="[href, label, Icon] in extra" :key="href" :href="href"
              ><component :is="Icon" :size="17" />{{ label }}</Link
            >
          </nav>
        </details>
        <Link
          href="/profile"
          class="icon-button header-settings"
          aria-label="Profil und Zyklus"
          ><Settings :size="18" /><span
            class="header-person"
          v-if="diary.profile?.display_name"
          >{{ diary.profile.display_name }}</span
          ></Link
        >
      </header>
      <main id="main-content" class="main" tabindex="-1">
        <div v-if="page.props.loadError" role="alert" class="alert error">
          {{ page.props.loadError }}
          <UiButton @click="reload">Erneut laden</UiButton>
        </div>
        <div id="entry-workspace"></div>
        <div v-show="!workspace.stack.length" class="page-content">
          <slot />
        </div>
      </main>
    </div>
    <nav class="bottom-nav no-print" aria-label="Hauptnavigation">
      <Link
        v-for="[href, label, Icon] in nav"
        :key="href"
        :href="href"
        class="bottom-link"
        :class="{ active: path === href }"
        :aria-current="path === href ? 'page' : undefined"
        ><component :is="Icon" :size="20" /><span>{{ label }}</span></Link
      >
    </nav>
    <ToastHost />
  </div>
</template>
