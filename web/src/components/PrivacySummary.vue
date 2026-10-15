<script setup>
import { ShieldCheck } from "@lucide/vue";

defineProps({
  compact: { type: Boolean, default: false },
});
</script>

<template>
  <aside
    class="privacy-summary"
    :class="{ 'privacy-summary-compact': compact }"
    aria-label="Datenschutzinformationen"
  >
    <div class="privacy-summary-main">
      <ShieldCheck :size="19" aria-hidden="true" />
      <div>
        <strong>Pseudonym und Ende-zu-Ende-Verschlüsselung</strong>
        <p>
          Dein Browser verschlüsselt Pseudonym und Tagebuch, bevor die Daten an
          den App-Server gesendet werden. Dort liegt nur der verschlüsselte
          Tresor.
        </p>
      </div>
    </div>
    <details>
      <summary>Was das schützt – und was nicht</summary>
      <ul>
        <li>
          Deine Passphrase und Wiederherstellungsphrase werden nicht gesendet.
          Ohne eine davon lässt sich der Tresor nicht öffnen.
        </li>
        <li>Ein Pseudonym ist keine Anonymität. Nutze keinen echten Namen.</li>
        <li>
          Verschlüsselung schützt nicht vor einem entsperrten oder
          kompromittierten Gerät oder vor verändertem App-Code.
        </li>
        <li>
          Im entsperrten Zustand liegt das Tagebuch im Arbeitsspeicher dieses
          Browsers. Sperre es, wenn du das Gerät verlässt.
        </li>
        <li>
          Ein pseudonymes Konto schützt den Zugriff auf den verschlüsselten
          Tresor, kann ihn aber nicht öffnen. Auf jedem neuen Gerät brauchst du
          zusätzlich die Tresor-Passphrase oder Wiederherstellungsphrase.
        </li>
        <li>
          Nutze den Fernzugriff nur über eine HTTPS-Verbindung. Das Konto macht
          dich nicht anonym und kann eine vergessene Tresor-Passphrase nicht
          zurücksetzen.
        </li>
        <li>
          Alte Datenbank-Sicherungen oder Exporte können noch unverschlüsselte
          Einträge enthalten. Der Server sieht ausserdem Verbindungsdaten und
          die Grösse des Tresors.
        </li>
      </ul>
    </details>
  </aside>
</template>
