const browserApi = typeof browser !== "undefined" ? browser : chrome;
const cached = {
  dial: null,
  volumeText: null,
  monoCheckbox: null,
  rememberCheckbox: null,
  enableCheckbox: null,
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
    const toggleBtn = document.getElementById("enable-toggle");
    if (toggleBtn) toggleBtn.style.display = "none";
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
  const toggleBtn = document.getElementById("enable-toggle");
  const domain = extractRootDomain(tab.url);

  if (!domain) {
    if (toggleBtn) toggleBtn.style.display = "none";
    return;
  } else {
    if (toggleBtn) toggleBtn.style.display = "flex";
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
      if (toggleBtn) toggleBtn.style.display = "none";
      return;
    }

    let isExcluded = data.fqdns.includes(domain);

    if (toggleBtn) {
      toggleBtn.classList.toggle("disabled", isExcluded);
      toggleBtn.querySelector(".toggle-state").textContent = isExcluded ? "OFF" : "ON";
      
      // Add pulse animation for state change
      toggleBtn.classList.add("state-changed");
      setTimeout(() => {
        toggleBtn.classList.remove("state-changed");
      }, 300);
      
      // Hide other controls when disabled
      const topControls = document.querySelector(".top-controls");
      const leftControls = document.querySelector(".left");
      const exclusionMessage = document.querySelector(".exclusion-message");
      if (topControls) topControls.style.display = isExcluded ? "none" : "";
      if (leftControls) leftControls.style.display = isExcluded ? "none" : "";
      
      // Show/hide exclusion message via class
      if (exclusionMessage) {
        if (isExcluded) {
          exclusionMessage.classList.remove("hidden");
        } else {
          exclusionMessage.classList.add("hidden");
        }
      }
    }

    toggleBtn.onclick = () => {
      const isActive = !toggleBtn.classList.contains("disabled");
      toggleSitePermission(domain, isActive, tab.id);
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
                () => {},
              );
              browserApi.tabs.sendMessage(
                tabId,
                { command: "setMono", mono: Boolean(settings[domain].mono) },
                () => {},
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
    const rememberCheckbox = document.getElementById("remember-checkbox");
    if (!rememberCheckbox || !rememberCheckbox.checked || !tab || !tab.url)
      return;

    const domain = extractRootDomain(tab.url);
    if (!domain) return;

    const volumeDial =
      cached.dial || document.getElementById("volume-dial");
    const monoCheckbox =
      cached.monoCheckbox || document.getElementById("mono-checkbox");

    const data = await storageGet({ siteSettings: {} });
    data.siteSettings = data.siteSettings || {};
    data.siteSettings[domain] = {
      volume: parseInt(volumeDial?.dataset.value || 0, 10) || 0,
      mono: Boolean(monoCheckbox?.checked),
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
  const monoCheckbox =
    cached.monoCheckbox || document.querySelector("#mono-checkbox");
  if (tab && monoCheckbox) {
    browserApi.tabs.sendMessage(
      tab.id,
      { command: "setMono", mono: monoCheckbox.checked },
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
    const rememberCheckbox = document.getElementById("remember-checkbox");
    const domain = extractRootDomain(tab.url);
    if (!domain) return;

    if (rememberCheckbox && rememberCheckbox.checked) {
      await saveSiteSettings(tab);
    } else {
      const data = await storageGet({ siteSettings: {} });
      if (data.siteSettings && data.siteSettings[domain]) {
        delete data.siteSettings[domain];
        await storageSet({ siteSettings: data.siteSettings });
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
    const left = document.querySelector(".left");
    if (top) top.classList.add("hidden");
    if (left) left.classList.add("hidden");
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
  const monoCheckbox = document.querySelector("#mono-checkbox");
  const rememberCheckbox = document.querySelector("#remember-checkbox");

  cached.dial = volumeDial;
  cached.volumeText = volumeText;
  cached.monoCheckbox = monoCheckbox;
  cached.rememberCheckbox = rememberCheckbox;

  if (volumeDial) {
    // Dial interaction is handled by initializeDial function
    volumeDial.dataset.value = "0";
  }

  if (volumeText) {
    volumeText.addEventListener("change", () => {
      const val = volumeText.value.match(/\d+/)?.[0];
      if (val) {
        // Convert VLC-style percentage back to dB range
        // 0% = -32 dB, 100% = 0 dB, 200% = +32 dB
        const percentage = Math.max(0, Math.min(200, parseInt(val)));
        const dB = Math.round((percentage / 200) * 64 - 32);
        setVolume(dB, tab);
      }
    });
  }

  if (monoCheckbox)
    monoCheckbox.addEventListener("change", () => toggleMono(tab));
  if (rememberCheckbox)
    rememberCheckbox.addEventListener("change", () => toggleRemember(tab));

  const domain = extractRootDomain(tab.url);
  if (!domain) return;

  try {
    const data = await storageGet({ siteSettings: {} });
    const saved = (data.siteSettings || {})[domain];
    if (saved) {
      if (rememberCheckbox) rememberCheckbox.checked = true;
      if (saved.volume !== undefined) setVolume(saved.volume, null);
      if (saved.mono !== undefined && monoCheckbox)
        monoCheckbox.checked = saved.mono;
    } else {
      browserApi.tabs.sendMessage(
        tab.id,
        { command: "getVolume" },
        (response) => {
          if (browserApi.runtime.lastError) {
            // Content script not available, ignore
            return;
          }
          if (response && response.response !== undefined) {
            setVolume(response.response, null);
          }
        },
      );
      browserApi.tabs.sendMessage(
        tab.id,
        { command: "getMono" },
        (response) => {
          if (browserApi.runtime.lastError) {
            // Content script not available, ignore
            return;
          }
          if (response && response.response !== undefined) {
            if (monoCheckbox) monoCheckbox.checked = response.response;
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
    // Convert angle to 0-360 range for easier calculation
    while (angle < 0) angle += 360;
    while (angle >= 360) angle -= 360;
    return angle;
  }

  function constrainAngleToRange(angle) {
    // Normalize angle to -180 to +180 range
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    
    // Map to our usable range: -135° to +135° 
    // This gives smooth continuous rotation
    if (angle < -135) angle = -135;
    if (angle > 135) angle = 135;
    
    return angle;
  }

  function angleToVolume(angle) {
    // Map -135° to +135° to -32 to +32 dB
    const normalizedAngle = (angle + 135) / 270; // 0 to 1
    return Math.round(normalizedAngle * 64 - 32);
  }

  function updateDialFromAngle(angle) {
    const constrainedAngle = constrainAngleToRange(angle);
    const volume = angleToVolume(constrainedAngle);
    
    dial.dataset.value = volume;
    updateDialRotation(dial, volume);
    
    // Update text and send volume change
    const text = cached.volumeText || document.querySelector("#volume-text");
    if (text) text.value = formatValue(volume);
    
    // Get current tab and send volume message
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
    
    // Get current angle from dial position
    const currentVolume = parseInt(dial.dataset.value || 0);
    const normalizedVolume = (currentVolume + 32) / 64; // 0 to 1
    currentAngle = normalizedVolume * 270 - 135; // -135 to +135
    
    startAngle = getAngleFromCenter(clientX, clientY);
    
    // Add visual feedback
    dial.classList.add('active');
    e.preventDefault();
  }

  function handleMove(e) {
    if (!isDragging) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const currentMouseAngle = getAngleFromCenter(clientX, clientY);
    let angleDiff = currentMouseAngle - startAngle;
    
    // Handle angle wrapping for continuous rotation
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    
    // Apply the difference to current angle
    const newAngle = currentAngle + angleDiff;
    updateDialFromAngle(newAngle);
    
    // Update start angle for next movement
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
    
    // Calculate distance from center
    const distance = Math.sqrt(Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2));
    const dialRadius = rect.width / 2;
    
    // Check if click is in center area (knob) - use 40% of dial radius as threshold
    if (distance < dialRadius * 0.4) {
      // Reset to 100% (0 dB)
      updateDialFromAngle(0);
      return;
    }
    
    // Calculate angle from click position
    const angle = Math.atan2(clientY - centerY, clientX - centerX);
    const angleDegrees = angle * (180 / Math.PI);
    
    // Update volume based on click angle
    updateDialFromAngle(angleDegrees);
  }

  function handleWheel(e) {
    e.preventDefault();
    const currentVolume = parseInt(dial.dataset.value || 0);
    const delta = e.deltaY > 0 ? -2 : 2; // Scroll down = decrease, up = increase
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

  // Mouse events
  dial.addEventListener('mousedown', handleStart);
  dial.addEventListener('click', handleClick);
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleEnd);
  
  // Wheel event for scroll support
  dial.addEventListener('wheel', handleWheel);

  // Touch events
  dial.addEventListener('touchstart', handleStart);
  dial.addEventListener('touchend', handleClick);
  document.addEventListener('touchmove', handleMove);
  document.addEventListener('touchend', handleEnd);

  // Initialize to 0 dB (center position)
  dial.dataset.value = "0";
  updateDialRotation(dial, 0);
}

function updateDialRotation(dial, dB) {
  // Map -32 to +32 dB to -135° to +135°
  const normalizedVolume = (parseInt(dB) + 32) / 64; // 0 to 1
  const angle = normalizedVolume * 270 - 135; // -135 to +135
  
  const indicator = dial.querySelector('.dial-indicator');
  if (indicator) {
    indicator.style.transform = `translateX(-50%) rotate(${angle}deg)`;
  }
}
