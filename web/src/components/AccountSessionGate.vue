<script setup>
import { computed, ref } from "vue";
import { usePage } from "@inertiajs/vue3";
import { KeyRound, ShieldCheck } from "@lucide/vue";

const props = defineProps({
  initialAuthenticated: { type: Boolean, default: true },
  initialAccountConfigured: { type: Boolean, default: false },
});
const page = usePage();
const authenticated = computed(
  () => page.props?.accountAuthenticated ?? props.initialAuthenticated,
);
const accountConfigured = computed(
  () => page.props?.accountConfigured ?? props.initialAccountConfigured,
);
const username = ref(null);
const password = ref(null);
const setupToken = ref(null);
const busy = ref(false);
const error = ref("");

function clearCredentials() {
  if (password.value) password.value.value = "";
  if (setupToken.value) setupToken.value.value = "";
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const action = accountConfigured.value ? "login" : "register";
  const payload = {
    username: username.value?.value || "",
    password: password.value?.value || "",
    ...(accountConfigured.value
      ? {}
      : { setup_token: setupToken.value?.value || "" }),
  };
  try {
    const response = await fetch(`/api/auth/${action}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Diary-Request": "1",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let body;
      try {
        body = await response.json();
      } catch {}
      throw new Error(
        body?.error?.message || "Anmeldung gerade nicht möglich.",
      );
    }
    clearCredentials();
    window.location.replace("/");
  } catch (cause) {
    error.value = cause.message;
    clearCredentials();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main v-if="!authenticated" class="vault-gate account-gate">
    <section class="vault-panel account-panel" aria-labelledby="account-title">
      <div class="vault-mark"><ShieldCheck :size="24" /></div>
      <p class="eyebrow">GUTFEELING · PRIVATES TAGEBUCH</p>
      <h1 id="account-title">
        {{ accountConfigured ? "Auf deinen Tresor zugreifen" : "Konto einrichten" }}
      </h1>
      <p class="vault-intro">
        {{
          accountConfigured
            ? "Melde dich auf diesem Gerät an. Danach entsperrst du dein Tagebuch mit deiner separaten Tresor-Passphrase."
            : "Erstelle das einmalige Konto für deine Geräte. Verwende einen frei gewählten Namen statt deiner E-Mail-Adresse."
        }}
      </p>
      <form class="vault-form" @submit.prevent="submit">
        <label v-if="!accountConfigured" class="vault-field">
          Einmaliger Einrichtungscode
          <input
            ref="setupToken"
            class="d-input"
            type="password"
            autocomplete="off"
            required
          />
          <span>Du findest ihn in der privaten .env-Datei des Servers.</span>
        </label>
        <label class="vault-field">
          Benutzername
          <input
            ref="username"
            class="d-input"
            autocomplete="username"
            minlength="3"
            maxlength="32"
            pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
            required
          />
          <span v-if="!accountConfigured">3–32 Zeichen; keine E-Mail nötig.</span>
        </label>
        <label class="vault-field">
          {{ accountConfigured ? "Kontopasswort" : "Neues Kontopasswort" }}
          <input
            ref="password"
            class="d-input"
            type="password"
            :autocomplete="accountConfigured ? 'current-password' : 'new-password'"
            minlength="12"
            maxlength="1024"
            required
          />
          <span>Mindestens 12 Zeichen. Nutze ein anderes Passwort als für den Tresor.</span>
        </label>
        <p v-if="error" class="alert error" role="alert">{{ error }}</p>
        <button class="button primary account-submit" :disabled="busy">
          <KeyRound :size="16" />
          {{ busy ? "Wird geprüft …" : accountConfigured ? "Anmelden" : "Konto erstellen" }}
        </button>
      </form>
      <p class="vault-footnote">
        Dein Kontopasswort meldet Geräte an, kann aber den Tagebuch-Tresor nicht
        entschlüsseln. Pro neuem Gerät brauchst du zusätzlich die Tresor-Passphrase
        oder deine Wiederherstellungsphrase. Anmeldung und Kontopasswort brauchen
        HTTPS, wenn du den Server ausserhalb deines Geräts verwendest.
      </p>
    </section>
  </main>
  <slot v-else />
</template>
