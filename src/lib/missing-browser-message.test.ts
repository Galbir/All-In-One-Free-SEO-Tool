/**
 * The "headless browser is missing" message, per install mode.
 *
 * This message has now been wrong twice, in opposite directions, and both
 * times a real user filed the report:
 *
 *   #37 — a Windows user who installed by double-clicking the launcher was
 *         told to run `npx playwright install chromium` in a terminal.
 *   #47 — after that fix pointed everyone at the launcher's new button, a
 *         Docker user on Linux (paths under `/app`, no Desktop, no
 *         launcher) was told to press it.
 *
 * The lesson is not "write a better sentence". It is that the advice
 * depends on how the person installed, and a single hardcoded answer is
 * guaranteed to be wrong for somebody. Hence a test per mode.
 *
 * On Docker the *cause* differs too — a stale image carrying browsers for
 * a different Playwright release, not a skipped download — so advice that
 * only says "install chromium" is wrong even when it appears to work,
 * because a container recreate undoes it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSE_SERVICE, missingBrowserMessage } from "./browser-pool";

describe("missingBrowserMessage", () => {
  describe("Docker", () => {
    const msg = missingBrowserMessage({ docker: true, platform: "linux" });

    it("says to rebuild the image, which is the actual fix", () => {
      expect(msg).toContain("docker compose up -d --build");
    });

    it("names the real cause rather than a skipped download", () => {
      expect(msg.toLowerCase()).toContain("image");
      expect(msg).toMatch(/built before|different release/i);
    });

    it("does not mention the Desktop launcher, which does not exist here", () => {
      // The regression from #47, stated as a test.
      expect(msg).not.toMatch(/desktop/i);
      expect(msg).not.toMatch(/launcher/i);
      expect(msg).not.toMatch(/Install headless browser/i);
    });

    it("gives the stopgap but says it does not survive a recreate", () => {
      expect(msg).toContain("docker compose exec");
      expect(msg).toMatch(/undone|recreated/i);
    });

    it("names the service docker-compose.yml actually defines", () => {
      // The first draft of this message said `docker compose exec app`.
      // The service is `seo`, so the command a reader pastes would answer
      // "no such service: app" — a confidently wrong instruction inside
      // the fix for a confidently wrong instruction.
      const compose = readFileSync(
        join(process.cwd(), "docker-compose.yml"),
        "utf8",
      );
      const services = [...compose.matchAll(/^ {2}([a-z][a-z0-9_-]*):/gm)].map(
        (m) => m[1],
      );
      // Volumes are declared the same way at the top level, so only trust
      // what sits under `services:`.
      const servicesBlock = compose.slice(
        compose.indexOf("services:"),
        compose.search(/^volumes:/m) === -1
          ? undefined
          : compose.search(/^volumes:/m),
      );
      const defined = [...servicesBlock.matchAll(/^ {2}([a-z][a-z0-9_-]*):/gm)].map(
        (m) => m[1],
      );

      expect(services.length, "no services parsed from compose").toBeGreaterThan(0);
      expect(
        defined,
        `the message says \`docker compose exec ${COMPOSE_SERVICE}\` but ` +
          `docker-compose.yml defines ${defined.join(", ")}`,
      ).toContain(COMPOSE_SERVICE);
      expect(msg).toContain(`docker compose exec ${COMPOSE_SERVICE} `);
    });
  });

  describe("Windows, installed by launcher", () => {
    const msg = missingBrowserMessage({ docker: false, platform: "win32" });

    it("points at the button, because that is how they installed", () => {
      expect(msg).toContain("Install headless browser");
      expect(msg).toMatch(/launcher/i);
    });

    it("still offers the terminal command for people who prefer it", () => {
      expect(msg).toContain("npx playwright install chromium");
    });

    it("says nothing about Docker", () => {
      expect(msg).not.toMatch(/docker/i);
    });
  });

  describe("macOS / Linux, installed natively", () => {
    for (const platform of ["darwin", "linux"]) {
      it(`${platform}: gives the command, not a Windows button`, () => {
        const msg = missingBrowserMessage({ docker: false, platform });
        expect(msg).toContain("npx playwright install chromium");
        expect(msg).not.toMatch(/desktop/i);
        expect(msg).not.toMatch(/docker/i);
      });
    }
  });

  it("every mode says which features actually need it", () => {
    // Someone hitting this is usually mid-task and about to conclude the
    // whole tool is broken. It is not: most of it does not need Chromium.
    for (const env of [
      { docker: true, platform: "linux" },
      { docker: false, platform: "win32" },
      { docker: false, platform: "darwin" },
    ]) {
      const msg = missingBrowserMessage(env);
      expect(msg, JSON.stringify(env)).toMatch(/rank checks/i);
      expect(msg, JSON.stringify(env)).toMatch(/audits and content tools/i);
    }
  });

  it("reads RUNNING_IN_DOCKER when no override is passed", () => {
    // Both the Dockerfile and docker-compose.yml set this, so detection in
    // production needs no argument.
    const before = process.env.RUNNING_IN_DOCKER;
    try {
      process.env.RUNNING_IN_DOCKER = "1";
      expect(missingBrowserMessage({ platform: "linux" })).toContain(
        "docker compose up -d --build",
      );
      delete process.env.RUNNING_IN_DOCKER;
      expect(missingBrowserMessage({ platform: "linux" })).not.toMatch(/docker/i);
    } finally {
      if (before === undefined) delete process.env.RUNNING_IN_DOCKER;
      else process.env.RUNNING_IN_DOCKER = before;
    }
  });
});
