---
theme: default
title: GutFeeling · A private food and symptom diary
colorSchema: light
fonts:
  provider: none
  sans: system-ui
transition: fade
---

<div class="deck-split cover-slide">
<div class="deck-copy">
  <h1>GutFeeling</h1>
  <p class="deck-lead">A private diary for meals and digestive symptoms.</p>
  <p class="deck-small">Bauchgefühl in the German app</p>
</div>
<img class="phone" src="/screens/today.png" alt="The Today screen with quick actions and fictional diary entries" />
</div>

<!--
Have you ever tried to remember what you ate before a stomach ache? GutFeeling gives you a private place to record those moments and look back at them together. The screens in this deck use fictional entries.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>A meal takes a few taps</h1>
  <p>Pick a recent recipe or search by name or ingredient. Set the time and portions.</p>
  <p>The meal keeps a copy of its ingredients, even if you edit the recipe later.</p>
</div>
<img class="phone" src="/screens/meal.png" alt="Meal entry showing recent recipes and the option to add a new recipe inline" />
</div>

<!--
Say you had a rice bowl for lunch. Pick it from your recent recipes and confirm the time. That saves what was actually in the meal, even if next week you make the same bowl differently.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>The recipe crawler</h1>
  <p>Paste a recipe link. The crawler reads recipe data in the page and can fall back to marked-up HTML.</p>
  <p>Review ingredients and confirm allergens before saving.</p>
</div>
<img class="phone" src="/screens/recipe.png" alt="Add recipe form with a web link and editable ingredient suggestions" />
</div>

<!--
The crawler turns a recipe link into a draft that is ready to review. It looks for standard recipe metadata first, then documented HTML patterns. Keeping the review step matters because source sites vary, especially in how they show ingredient quantities and allergens.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>When symptoms start</h1>
  <p>Select the symptoms, tap their intensity, and record when they began.</p>
  <p>A later check-in can record that you felt well again. Stress, sleep, stool, and cycle context are optional.</p>
</div>
<img class="phone" src="/screens/symptom.png" alt="Symptom check-in with the bloating intensity control" />
</div>

<!--
If I felt bloated three hours after the rice bowl, I add a check-in at that time. If I feel fine in the evening, I can record that separately. I can link the earlier moment to a meal or leave it outside the meal comparison.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>Diary and calendar</h1>
  <p>The diary keeps meals and check-ins in time order and lets you correct them later.</p>
  <p>The calendar shows which days still need a follow-up.</p>
</div>
<img class="phone" src="/screens/calendar.png" alt="Calendar view showing days with fictional meals and check-ins" />
</div>

<!--
Think of the calendar as a way to spot gaps. A meal alone tells us very little about how you felt afterwards. You can return to a date, add a check-in, or fix a timestamp in the diary.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>What the app compares</h1>
  <p>It counts symptom moments with and without each ingredient in the relevant meal window.</p>
  <p>Sample counts and overlapping ingredients show when a pattern is uncertain.</p>
</div>
<img class="screen" src="/screens/pattern.png" alt="Pattern result comparing symptom moments with and without a demo ingredient" />
</div>

<!--
The app compares documented moments after meals that contained an ingredient with moments where the ingredient was absent. If two ingredients always occur together, the app cannot tell them apart. The result is a clue to investigate and cannot diagnose a food intolerance.
-->

---
layout: default
---

<div class="deck-notes">
  <h1>How the text and analysis work</h1>
  <dl>
    <dt>Ingredient names</dt>
    <dd>Local rules group “1 pinch of salt” and “salt” under the same ingredient.</dd>
    <dt>Language tools</dt>
    <dd>The Python service offers NLTK text matching and CPU-only Tiny BERT for semantic similarity. The diary uses reviewed ingredient mappings.</dd>
    <dt>Dietary patterns</dt>
    <dd>With enough observations, an exploratory model can compare multiple factors. It runs in the unlocked browser.</dd>
  </dl>
</div>

<!--
Consistent ingredient names make the comparison possible. Tiny BERT is available for similarity experiments, while the app keeps uncertain ingredients reviewable. The pattern model is exploratory and its results depend on what was recorded.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>A report for the appointment</h1>
  <p>Summarize symptoms, ingredient overlaps, timing, and stress in one view.</p>
  <p>Preview the report, then print it as a PDF or share it with a clinician.</p>
</div>
<img class="screen" src="/screens/report.png" alt="Top of the doctor report for a fictional diary" />
</div>

<!--
Instead of bringing a list of every meal, you can bring the report with the documented period and recurring patterns. It gives you something concrete to discuss with a healthcare professional.
-->

---

<div class="deck-split">
<div class="deck-copy">
  <h1>A private diary across devices</h1>
  <p>Sign in with a pseudonym. Use a separate vault passphrase to unlock the diary.</p>
  <p>The browser encrypts entries before syncing. The server stores ciphertext.</p>
  <p>Independent edits merge on-device. Conflicting edits stop before they can overwrite saved data.</p>
</div>
<img class="phone" src="/screens/vault.png" alt="The encrypted diary unlock screen" />
</div>

<!--
Signing in gives the device access to the encrypted copy. The separate passphrase unlocks it in the browser. Independent edits merge on-device. If two devices change the same field, the app keeps the saved copy and asks you to enter your edit again. The recovery phrase and encrypted backup are useful if you lose a device. Anyone you deliberately give an exported report can read that report.
-->

---
layout: default
---

<div class="deck-notes">
  <h1>How GutFeeling runs</h1>
  <dl>
    <dt>Browser</dt>
    <dd>Vue and Inertia power the mobile-first interface. Encryption and diary analysis run on the device.</dd>
    <dt>Own server</dt>
    <dd>Go Fiber manages sign-in and sync. SurrealDB holds the encrypted diary. Python handles recipe links and text tools.</dd>
    <dt>Local demo</dt>
    <dd>Start the stack with Docker Compose and open <code>localhost:3000</code>.</dd>
  </dl>
</div>

<!--
That is the whole loop. Log a meal, record how you felt, and build enough documentation to explore a pattern. The app can run on your own server for one diary across multiple devices.
-->
