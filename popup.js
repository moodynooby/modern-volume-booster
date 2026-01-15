const browserApi = typeof browser !== "undefined" ? browser : chrome;
const cached = {
  dial: null,
  volumeText: null,
  monoBtn: null,
  rememberBtn: null,
  powerBtn: null,
};

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    try {
      browserApi.storage.local.get(keys, (res) => {
        if (browserApi.runtime.lastError) reject(browserApi.runtime.lastError);
        else resolve(res);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      browserApi.storage.local.set(obj, () => {
        if (browserApi.runtime.lastError) reject(browserApi.runtime.lastError);
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

function extractRootDomain(url) {
  if (!url) return null;
  if (url.startsWith("file:")) return "Local File";
  if (
    url.startsWith("chrome") ||
    url.startsWith("edge") ||
    url.startsWith("about") ||
    url.startsWith("extension")
  )
    return null;

  let domain = url.replace(/^(https?|ftp):\/\/(www\.)?/, "");
  domain = domain.split("/")[0];
  domain = domain.split(":")[0];
  return domain.toLowerCase();
}

document.addEventListener("DOMContentLoaded", () => {
  const dial = document.getElementById("volume-dial");
  if (dial) {
    initializeDial(dial);
  }

  const settingsBtn = document.getElementById("settings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      if (browserApi.runtime.openOptionsPage) {
        browserApi.runtime.openOptionsPage(() => {
          if (browserApi.runtime.lastError)
            console.error(browserApi.runtime.lastError);
        });
      } else {
        window.open(browserApi.runtime.getURL("options.html"));
      }
    });
  }

  browserApi.runtime.onMessage.addListener((message) => {
    if (message.type === "exclusion") showError({ type: "exclusion" });
  });

  listenForEvents();
});

function listenForEvents() {
  browserApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    handleTabs(tabs);
  });
}

function handleTabs(tabs) {
  const currentTab = tabs && tabs[0];

  if (!currentTab || !currentTab.url) {
    showError({ message: "No active tab." });
    return;
  }

  const protocol = currentTab.url.split(":")[0];
  const restrictedProtocols = [
    "chrome",
    "edge",
    "about",
    "extension",
    "chrome-extension",
    "moz-extension",
    "view-source",
  ];

  if (restrictedProtocols.includes(protocol)) {
    showError({ message: "Volume control is not available on system pages." });
    const powerBtn = document.getElementById("power-toggle");
    if (powerBtn) powerBtn.style.display = "none";
    return;
  }

  updateEnableSwitch(currentTab);

  browserApi.tabs.sendMessage(
    currentTab.id,
    { command: "checkExclusion" },
    (response) => {
      if (browserApi.runtime.lastError) {
        // Content script didn't respond — fall back to storage check to decide whether the page is truly excluded.
        (async () => {
          try {
            const domain = extractRootDomain(currentTab.url);
            if (!domain) {
              showError({ type: "exclusion" });
              return;
            }
            const data = await storageGet({
              fqdns: [],
              whitelist: [],
              whitelistMode: false,
              siteSettings: {},
            });
            let isExcluded = false;
            if (data.whitelistMode) {
              const remembered = Object.keys(data.siteSettings || {});
              isExcluded = !remembered.includes(domain);
            } else {
              isExcluded = data.fqdns.includes(domain);
            }
            if (isExcluded) showError({ type: "exclusion" });
          } catch (e) {
            showError({ type: "exclusion" });
          }
        })();
      }
    },
  );

  initializeControls(currentTab);
}

async function updateEnableSwitch(tab) {
  const powerBtn = document.getElementById("power-toggle");
  const domain = extractRootDomain(tab.url);

  if (!domain) {
    if (powerBtn) powerBtn.style.display = "none";
    return;
  } else {
    if (powerBtn) powerBtn.style.display = "flex";
  }

  try {
    const data = await storageGet({
      fqdns: [],
      whitelist: [],
      whitelistMode: false,
      siteSettings: {},
    });

    // When whitelist mode is active, remembered sites determine which pages are allowed.
    // Hide the enable/active switch to avoid duplicate controls and potential user confusion.
    if (data.whitelistMode) {
      if (powerBtn) powerBtn.style.display = "none";
      return;
    }

    let isExcluded = data.fqdns.includes(domain);
    // Invert logic: Excluded means OFF (not active), Included means ON (active)
    let isActive = !isExcluded;

    if (powerBtn) {
      powerBtn.classList.toggle("active", isActive);

      // Hide other controls when disabled (excluded)
      const topControls = document.querySelector(".top-controls");
      const exclusionMessage = document.querySelector(".exclusion-message");

      if (topControls) topControls.style.display = isActive ? "" : "none";

      // Show/hide exclusion message via class
      if (exclusionMessage) {
        if (!isActive) {
          exclusionMessage.classList.remove("hidden");
        } else {
          exclusionMessage.classList.add("hidden");
        }
      }
    }

    powerBtn.onclick = () => {
      // Toggle state
      const setExcluded = powerBtn.classList.contains("active"); // If active, we want to exclude (turn off)
      toggleSitePermission(domain, setExcluded, tab.id);
    };
  } catch (e) {
    handleError(e);
  }
}

async function toggleSitePermission(domain, shouldExclude, tabId) {
  try {
    const data = await storageGet({
      fqdns: [],
      whitelist: [],
      whitelistMode: false,
    });
    const newData = {};

    if (data.whitelistMode) {
      // Edit remembered sites instead of an arbitrary whitelist
      const sd = await storageGet({ siteSettings: {} });
      const settings = sd.siteSettings || {};
      if (shouldExclude) {
        if (settings[domain]) {
          delete settings[domain];
          await storageSet({ siteSettings: settings });
        }
      } else {
        if (!settings[domain]) {
          settings[domain] = { volume: 0, mono: false };
          await storageSet({ siteSettings: settings });
          // Try to apply settings immediately to the tab that requested the change
          if (tabId) {
            try {
              browserApi.tabs.sendMessage(
                tabId,
                { command: "setVolume", dB: settings[domain].volume },
                () => { },
              );
              browserApi.tabs.sendMessage(
                tabId,
                { command: "setMono", mono: Boolean(settings[domain].mono) },
                () => { },
              );
            } catch (e) {
              /* ignore */
            }
          }
        }
      }
    } else {
      newData.fqdns = data.fqdns || [];
      if (shouldExclude) {
        if (!newData.fqdns.includes(domain)) newData.fqdns.push(domain);
      } else {
        const idx = newData.fqdns.indexOf(domain);
        if (idx > -1) newData.fqdns.splice(idx, 1);
      }
      await storageSet({ fqdns: newData.fqdns });
    }

    browserApi.tabs.reload(tabId);
    window.close();
  } catch (e) {
    handleError(e);
  }
}

function handleError(error) {
  const msg = error.message || error;
  if (typeof msg === "string") {
    if (
      msg.includes("Receiving end does not exist") ||
      msg.includes("Could not establish connection") ||
      msg.includes("message channel closed")
    ) {
      return;
    }
  }
  console.error(`Volume Control: Error: ${msg}`);
}

function formatValue(dB) {
  const n = Number(dB);
  if (Number.isNaN(n)) return "";

  // VLC-style scaling: 0 dB = 100%, can go above 100% for boost
  // -32 dB = 0%, 0 dB = 100%, +32 dB = 200%
  const percentage = Math.round(((n + 32) / 64) * 200);
  return `${percentage}%`;
}

async function saveSiteSettings(tab) {
  try {
    const rememberBtn = document.getElementById("remember-toggle");
    // Check 'active' class instead of 'checked' property
    if (!rememberBtn || !rememberBtn.classList.contains("active") || !tab || !tab.url)
      return;

    const domain = extractRootDomain(tab.url);
    if (!domain) return;

    const volumeDial =
      cached.dial || document.getElementById("volume-dial");
    const monoBtn =
      cached.monoBtn || document.getElementById("mono-toggle");

    const data = await storageGet({ siteSettings: {} });
    data.siteSettings = data.siteSettings || {};
    data.siteSettings[domain] = {
      volume: parseInt(volumeDial?.dataset.value || 0, 10) || 0,
      mono: Boolean(monoBtn?.classList.contains("active")),
    };
    await storageSet({ siteSettings: data.siteSettings });

    // Notify the content script in this tab immediately so volume/mono are applied without waiting
    if (tab && tab.id) {
      try {
        browserApi.tabs.sendMessage(
          tab.id,
          { command: "setVolume", dB: data.siteSettings[domain].volume },
          () => {
            if (browserApi.runtime && browserApi.runtime.lastError) {
              // It's possible the content script hasn't injected into the page yet; ignore harmless errors.
            }
          },
        );
        browserApi.tabs.sendMessage(
          tab.id,
          { command: "setMono", mono: Boolean(data.siteSettings[domain].mono) },
          () => {
            if (browserApi.runtime && browserApi.runtime.lastError) {
              // It's possible the content script hasn't injected into the page yet; ignore harmless errors.
            }
          },
        );
      } catch (e) {
        // ignore messaging errors
      }
    }
  } catch (e) {
    handleError(e);
  }
}

async function setVolume(dB, tab) {
  const dial = cached.dial || document.querySelector("#volume-dial");
  const text = cached.volumeText || document.querySelector("#volume-text");

  if (dial) {
    dial.dataset.value = String(dB);
    updateDialRotation(dial, dB);
  }
  if (text) text.value = formatValue(dB);

  if (tab) {
    browserApi.tabs.sendMessage(
      tab.id,
      { command: "setVolume", dB: Number(dB) },
      (response) => {
        if (browserApi.runtime.lastError)
          handleError(browserApi.runtime.lastError);
      },
    );
    await saveSiteSettings(tab);
  }
}

async function toggleMono(tab) {
  const monoBtn = cached.monoBtn || document.querySelector("#mono-toggle");
  if (tab && monoBtn) {
    // Toggle active state locally first
    monoBtn.classList.toggle("active");
    const isMono = monoBtn.classList.contains("active");

    browserApi.tabs.sendMessage(
      tab.id,
      { command: "setMono", mono: isMono },
      (res) => {
        if (browserApi.runtime.lastError)
          handleError(browserApi.runtime.lastError);
      },
    );
    await saveSiteSettings(tab);
  }
}

async function toggleRemember(tab) {
  try {
    const rememberBtn = document.getElementById("remember-toggle");
    const domain = extractRootDomain(tab.url);
    if (!domain) return;

    if (rememberBtn) {
      rememberBtn.classList.toggle("active");
      const isRemembered = rememberBtn.classList.contains("active");

      if (isRemembered) {
        await saveSiteSettings(tab);
      } else {
        const data = await storageGet({ siteSettings: {} });
        if (data.siteSettings && data.siteSettings[domain]) {
          delete data.siteSettings[domain];
          await storageSet({ siteSettings: data.siteSettings });
        }
      }
    }
  } catch (e) {
    handleError(e);
  }
}

function showError(error) {
  const popupContent = document.querySelector("#popup-content");
  const errorContent = document.querySelector("#error-content");
  const exclusionMessage = document.querySelector(".exclusion-message");

  if (popupContent) popupContent.classList.add("hidden");
  if (errorContent) errorContent.classList.add("hidden");
  if (exclusionMessage) exclusionMessage.classList.add("hidden");

  if (error.type === "exclusion") {
    if (popupContent) popupContent.classList.remove("hidden");
    if (exclusionMessage) exclusionMessage.classList.remove("hidden");

    const top = document.querySelector(".top-controls");
    // const left = document.querySelector(".left"); // Removed in new design
    if (top) top.classList.add("hidden");
    document.body.classList.add("excluded-site");
  } else {
    if (errorContent) {
      errorContent.classList.remove("hidden");
      errorContent.querySelector("p").textContent =
        error.message || "An error occurred";
    }
  }
}

async function initializeControls(tab) {
  if (!tab) return;

  const volumeDial = document.querySelector("#volume-dial");
  const volumeText = document.querySelector("#volume-text");
  const monoBtn = document.querySelector("#mono-toggle");
  const rememberBtn = document.querySelector("#remember-toggle");
  const powerBtn = document.querySelector("#power-toggle");

  cached.dial = volumeDial;
  cached.volumeText = volumeText;
  cached.monoBtn = monoBtn;
  cached.rememberBtn = rememberBtn;
  cached.powerBtn = powerBtn;

  if (volumeDial) {
    volumeDial.dataset.value = "0";
  }

  if (volumeText) {
    volumeText.addEventListener("change", () => {
      const val = volumeText.value.match(/\d+/)?.[0];
      if (val) {
        const percentage = Math.max(0, Math.min(200, parseInt(val)));
        const dB = Math.round((percentage / 200) * 64 - 32);
        setVolume(dB, tab);
      }
    });
  }

  if (monoBtn)
    monoBtn.addEventListener("click", () => toggleMono(tab));
  if (rememberBtn)
    rememberBtn.addEventListener("click", () => toggleRemember(tab));

  const domain = extractRootDomain(tab.url);
  if (!domain) return;

  try {
    const data = await storageGet({ siteSettings: {} });
    const saved = (data.siteSettings || {})[domain];
    if (saved) {
      if (rememberBtn) rememberBtn.classList.add("active");
      if (saved.volume !== undefined) setVolume(saved.volume, null);
      if (saved.mono !== undefined && monoBtn)
        monoBtn.classList.toggle("active", saved.mono);
    } else {
      browserApi.tabs.sendMessage(
        tab.id,
        { command: "getVolume" },
        (response) => {
          if (browserApi.runtime.lastError) return;
          if (response && response.response !== undefined) {
            setVolume(response.response, null);
          }
        },
      );
      browserApi.tabs.sendMessage(
        tab.id,
        { command: "getMono" },
        (response) => {
          if (browserApi.runtime.lastError) return;
          if (response && response.response !== undefined) {
            if (monoBtn) monoBtn.classList.toggle("active", response.response);
          }
        },
      );
    }
  } catch (e) {
    handleError(e);
  }
}

// --- DIAL INTERACTION FUNCTIONS ---
function initializeDial(dial) {
  let isDragging = false;
  let startAngle = 0;
  let currentAngle = 0;

  function getAngleFromCenter(clientX, clientY) {
    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const angle = Math.atan2(clientY - centerY, clientX - centerX);
    return angle * (180 / Math.PI);
  }

  function normalizeAngle(angle) {
    while (angle < 0) angle += 360;
    while (angle >= 360) angle -= 360;
    return angle;
  }

  function constrainAngleToRange(angle) {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;

    if (angle < -135) angle = -135;
    if (angle > 135) angle = 135;

    return angle;
  }

  function angleToVolume(angle) {
    const normalizedAngle = (angle + 135) / 270;
    return Math.round(normalizedAngle * 64 - 32);
  }

  function updateDialFromAngle(angle) {
    const constrainedAngle = constrainAngleToRange(angle);
    const volume = angleToVolume(constrainedAngle);

    dial.dataset.value = volume;
    updateDialRotation(dial, volume);

    const text = cached.volumeText || document.querySelector("#volume-text");
    if (text) text.value = formatValue(volume);

    browserApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        setVolume(volume, tabs[0]);
      }
    });
  }

  function handleStart(e) {
    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const currentVolume = parseInt(dial.dataset.value || 0);
    const normalizedVolume = (currentVolume + 32) / 64;
    currentAngle = normalizedVolume * 270 - 135;

    startAngle = getAngleFromCenter(clientX, clientY);

    dial.classList.add('active');
    e.preventDefault();
  }

  function handleMove(e) {
    if (!isDragging) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const currentMouseAngle = getAngleFromCenter(clientX, clientY);
    let angleDiff = currentMouseAngle - startAngle;

    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    const newAngle = currentAngle + angleDiff;
    updateDialFromAngle(newAngle);

    startAngle = currentMouseAngle;
    currentAngle = newAngle;

    e.preventDefault();
  }

  function handleEnd() {
    isDragging = false;
    dial.classList.remove('active');
  }

  function handleClick(e) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const distance = Math.sqrt(Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2));
    const dialRadius = rect.width / 2;

    if (distance < dialRadius * 0.4) {
      updateDialFromAngle(0);
      return;
    }

    const angle = Math.atan2(clientY - centerY, clientX - centerX);
    const angleDegrees = angle * (180 / Math.PI);

    updateDialFromAngle(angleDegrees);
  }

  function handleWheel(e) {
    e.preventDefault();
    const currentVolume = parseInt(dial.dataset.value || 0);
    const delta = e.deltaY > 0 ? -2 : 2;
    const newVolume = Math.max(-32, Math.min(32, currentVolume + delta));

    dial.dataset.value = newVolume;
    updateDialRotation(dial, newVolume);

    const text = cached.volumeText || document.querySelector("#volume-text");
    if (text) text.value = formatValue(newVolume);

    browserApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        setVolume(newVolume, tabs[0]);
      }
    });
  }

  dial.addEventListener('mousedown', handleStart);
  dial.addEventListener('click', handleClick);
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleEnd);

  dial.addEventListener('wheel', handleWheel);

  dial.addEventListener('touchstart', handleStart);
  dial.addEventListener('touchend', handleClick);
  document.addEventListener('touchmove', handleMove);
  document.addEventListener('touchend', handleEnd);

  dial.dataset.value = "0";
  updateDialRotation(dial, 0);
}

function updateDialRotation(dial, dB) {
  const normalizedVolume = (parseInt(dB) + 32) / 64;
  const angle = normalizedVolume * 270 - 135;

  const indicator = dial.querySelector('.dial-indicator');
  if (indicator) {
    indicator.style.transform = `translateX(-50%) rotate(${angle}deg)`;
  }
}
