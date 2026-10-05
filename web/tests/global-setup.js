const profileURL = new URL(
  "/api/profile",
  process.env.APP_TEST_URL || "http://localhost:3001",
);

export default async function globalSetup() {
  if (profileURL.port === "3000") {
    throw new Error(
      "Playwright must use an isolated app/database, never the personal app on port 3000. Set APP_TEST_URL (for example http://localhost:3001).",
    );
  }

  const diaryURL = new URL("/api/diary", profileURL);
  const diaryResponse = await fetch(diaryURL);
  if (!diaryResponse.ok) {
    throw new Error(
      `Could not load isolated test profile: ${diaryResponse.status}`,
    );
  }
  const diary = await diaryResponse.json();
  if (
    diary.profile?.onboarding_completed &&
    diary.profile.display_name?.trim()
  ) {
    return;
  }

  const profile = {
    ...diary.profile,
    display_name: "Testperson UX",
    onboarding_completed: true,
  };
  const saveResponse = await fetch(profileURL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Diary-Request": "1",
    },
    body: JSON.stringify(profile),
  });
  if (!saveResponse.ok) {
    throw new Error(
      `Could not seed isolated test profile: ${saveResponse.status}`,
    );
  }
}
