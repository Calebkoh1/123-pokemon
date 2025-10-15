// sites/target/content-script.js - Main logic runner for Target (Performance Optimized)
// This script is injected last by background.js using executeScript
// Assumes utils.js, element-finder.js, storage.js, checkout-base.js, selectors.js, checkout.js have already been injected

// Use a single console statement that's easy to filter 
console.log("[TARGET-CHECKOUT] Starting execution - Performance Optimized Version");

// EARLY CART PAGE DETECTION - Immediately close cart page if setting enabled
if (window.location.pathname === '/cart') {
  console.log("Cart page detected - checking auto-close setting");
  if (typeof updateStatus === 'function') {
    updateStatus('Cart page detected - checking auto-close setting', 'status-waiting');
  }
  
  // Simplified approach: Auto-close the cart page if the setting is enabled
  async function autoCloseCartPage() {
    try {
      // Load settings to check if auto-close is enabled
      const data = await chrome.storage.local.get(['globalSettings']);
      const globalSettings = data.globalSettings || {};
      
      if (globalSettings.autoCloseCartPage) { // renamed from autoCloseIfOos
        console.log("Auto-close cart page is enabled, closing tab...");
        
        if (typeof updateStatus === 'function') {
          updateStatus('Auto-closing cart page...', 'status-running');
        }
        
        // Log this event for debugging
        console.error('---------- AUTO-CLOSING TAB: CART PAGE DETECTED ----------');
        
        // Try to close the tab
        window.close();
        
        // Second attempt after a short delay (as a fallback)
        setTimeout(() => {
          try {
            window.close();
          } catch (e) {
            console.error('Failed second close attempt:', e);
          }
        }, 100);
      } else {
        console.log("Auto-close cart page is disabled, keeping tab open");
        if (typeof updateStatus === 'function') {
          updateStatus('Cart page detected (automation disabled)', 'status-waiting');
        }
      }
    } catch (error) {
      console.error("Error in autoCloseCartPage:", error);
    }
  }
  
  // Run the auto-close check
  autoCloseCartPage();
  
  // Don't execute any further code on cart pages
  window.targetContentScriptExecuted = true; // Mark as executed to prevent future executions
} else {
  // Only continue with extension logic on non-cart pages

  // We need to re-attach our utilities to window for access
  const utils = {};
  const finder = {};
  const storage = {};
  const selectors = {};

  // Copy the functions from utils.js
  utils.sleep = sleep;
  utils.waitForElement = waitForElement;
  utils.findElementWithSelectors = findElementWithSelectors;
  utils.clickElement = clickElement;
  utils.fillField = fillField;
  utils.updateStatus = updateStatus;
  utils.debugLog = debugLog;
  utils.getFromStorage = getFromStorage;
  utils.saveToStorage = saveToStorage;
  utils.getProfiles = getProfiles;

  // Copy the functions from element-finder.js
  finder.findButtonByText = findButtonByText;
  finder.findElementWithSelectors = findElementWithSelectors;
  finder.fillFieldBySelectors = fillFieldBySelectors;
  finder.createElementWatcher = createElementWatcher;
  finder.createButtonWatcher = createButtonWatcher;
  finder.isElementVisible = isElementVisible;
  finder.isElementDisabled = isElementDisabled;

  // Copy the functions from storage.js
  storage.getFromStorage = getFromStorage;
  storage.saveToStorage = saveToStorage;
  storage.getSiteSettings = getSiteSettings;
  storage.updateSiteSettings = updateSiteSettings;
  storage.getProfiles = getProfiles;
  storage.saveProfile = saveProfile;
  storage.deleteProfile = deleteProfile;

  // Copy the selectors from selectors.js
  selectors.productPageSelectors = productPageSelectors;
  selectors.checkoutPageSelectors = checkoutPageSelectors;
  selectors.popupSelectors = popupSelectors;

  // Ensure this runs only once (still useful as a safeguard)
  if (!window.targetContentScriptExecuted) {
    window.targetContentScriptExecuted = true;

    // --- Initialize Core Logic ---
    // Using our newly created utility objects
    initializeTargetCheckout();


    // --- initializeTargetCheckout function and the rest of the script ---
    function initializeTargetCheckout() {
      console.log("Initializing Target checkout logic...");

      // Now these objects contain all the necessary functions


      // --- State variables ---
      let isEnabled = false;
      let siteSettings = {};
      let globalSettings = {};
      let checkoutInProgress = false;
      let currentStep = '';
      let profile = null;
      let placeOrderButtonClicked = false;
      let confirmButtonClicked = false; // For CVV confirm
      let verifyCardButtonClicked = false; // For potential card verify step
      let isFillingCardInput = false;
      let isFillingCvvInput = false;
      let inBuyNowErrorRecovery = false; // Flag to track Buy Now error recovery
      let observers = [];
      let intervals = [];

      // --- Initialization ---
      init();

      /**
       * Initialize the checkout system
       */
      async function init() {
        console.log("Target checkout init() called on page: " + window.location.pathname);

        // Double-check for cart page - skip all initialization for cart pages
        // Use exact pathname match to avoid blocking product pages
        if (window.location.pathname === '/cart') {
          console.log("Cart page detected in init() - checkout automation disabled for cart pages");
          utils.updateStatus('Cart page detected (automation disabled)', 'status-waiting');
          return; // Early exit without initializing anything
        }

        await loadSettingsAndProfile(); // Load settings and profile initially
        setupListeners();
        // Initial page detection after settings are loaded
        detectCurrentPage();
      }

  /**
   * Load settings and profile from storage
   */
  async function loadSettingsAndProfile() {
      try {
          console.log("Loading settings and profile from storage, previous isEnabled =", isEnabled);
          const data = await storage.getFromStorage([
              'siteSettings', // We only need site-specific settings now
              'globalSettings',
              'debugMode',
              'price_check_enabled',
              'price_check_closeTabOnFail',
              'price_check_items'
          ]);
          
          // Get the site settings with defaults
          siteSettings = data.siteSettings?.target || {
              enabled: false,
              quantity: 1,
              profileId: ''
          };
          
          globalSettings = data.globalSettings || {
              autoSubmit: true,
              randomizeDelay: false
          };
          
          // SIMPLIFIED: Only use the site-specific setting
          isEnabled = siteSettings.enabled === true;
          
          console.log(`Target enabled state: ${isEnabled} (using site-specific setting only)`);
          console.log(`Target quantity setting: ${siteSettings.quantity}`);
          console.log(`Target profile ID: ${siteSettings.profileId || 'not set'}`);
          
          // For extra reliability, cache the settings in sessionStorage
          try {
              window.sessionStorage.setItem('target_module_enabled', isEnabled ? 'true' : 'false');
              window.sessionStorage.setItem('target_module_quantity', siteSettings.quantity.toString());
              if (siteSettings.profileId) {
                  window.sessionStorage.setItem('target_module_profileId', siteSettings.profileId);
              }
          } catch (e) {
              console.warn("Could not save settings to sessionStorage:", e);
          }

          utils.debugLog('target-settings-loaded', { siteSettings, globalSettings, isEnabled });

              // Load profile data
              const profileData = await storage.getProfiles(); // { profiles: [], selectedProfile: {}, selectedProfileId: '' }
              const profiles = profileData.profiles || [];
              const siteProfileId = siteSettings.profileId; // ID from site settings (popup)
              const globalProfileId = profileData.selectedProfileId; // Globally selected ID (options page)

              profile = null; // Reset profile before searching
              
              console.log(`Profile selection: site profile ID = "${siteProfileId}", global profile ID = "${globalProfileId}", total profiles: ${profiles.length}`);

              // 1. Try site-specific profile ID (highest priority)
              if (siteProfileId) {
                  profile = profiles.find(p => p.id === siteProfileId);
                  if (profile) {
                      console.log(`Using site-specific profile: ${profile.name} (ID: ${profile.id})`);
                  } else {
                      console.warn(`Site-specific profile ID "${siteProfileId}" not found in available profiles.`);
                  }
              }

              // 2. If no site-specific profile found or selected, try global profile ID
              if (!profile && globalProfileId) {
                  profile = profiles.find(p => p.id === globalProfileId);
                  if (profile) {
                      console.log(`Using global profile: ${profile.name} (ID: ${profile.id})`);
                  } else {
                       console.warn(`Global profile ID "${globalProfileId}" not found in available profiles.`);
                  }
              }

              // 3. If still no profile, and profiles exist, default to the first one
              if (!profile && profiles.length > 0) {
                  profile = profiles[0];
                  console.log(`No profile ID specified or found, defaulting to first profile: ${profile.name} (ID: ${profile.id})`);
                  
                  // Actually save this selection back to both site settings and global storage
                  await storage.saveToStorage({ selectedProfile: profile.id });
                  siteSettings.profileId = profile.id;
                  await storage.updateSiteSettings('target', { profileId: profile.id });
                  console.log(`Updated site profile ID to first profile: ${profile.id}`);
              }

              if (!profile) {
                  console.warn("No checkout profile selected or found for Target.");
                  // Optionally update status if needed later
              } else {
                  utils.debugLog('target-profile-loaded', { profileName: profile.name });
              }

          } catch (error) {
              console.error("Error loading settings or profile:", error);
              isEnabled = false; // Disable if loading fails
              utils.updateStatus(`Error loading settings: ${error.message}`, 'status-waiting');
          }
      }


      /**
       * Set up message listeners
       */
      function setupListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          let asyncResponse = false;
          utils.debugLog('target-message-received', message); // Log received messages

          // Handle page detection from background script
          if (message.action === 'detectPage' && message.site === 'target') {
            // Skip processing for cart pages
            if (message.type === 'cart') {
              console.log("Cart page detection message received - ignoring");
              return;
            }
            handlePageDetection(message.type);
          }

          // Handle site activation command from background script
          if (message.action === 'activateSite' && message.site === 'target') {
              console.log("Target received 'activateSite'");
              const wasEnabled = isEnabled;
              siteSettings = message.siteSettings || siteSettings;
              // Use site-specific toggle as the main control
              isEnabled = siteSettings.enabled === true;
              console.log(`Target activation: Site=${siteSettings.enabled}, Effective=${isEnabled}`);
              if (!wasEnabled && isEnabled) {
                  onActivate();
              } else if (wasEnabled && !isEnabled) {
                  cleanup(); // Cleanup if activation message effectively disables it
              }
          }

          // Handle global toggle command from popup
          if (message.action === 'toggleStatus') {
              console.log("Target received 'toggleStatus'");
              const globalEnabled = message.enabled;
              const oldIsEnabled = isEnabled;
              isEnabled = globalEnabled && (siteSettings?.enabled || false); // Check site setting too
              console.log(`Target toggle: Global=${globalEnabled}, Site=${siteSettings?.enabled}, Effective=${isEnabled}`);

              if (oldIsEnabled && !isEnabled) {
                cleanup();
              } else if (!oldIsEnabled && isEnabled) {
                onActivate();
              }
          }

          // Handle site setting updates from popup/options
          if (message.action === 'updateSiteSetting' && message.site === 'target') {
             console.log(`Target setting update received in content script:`, message.siteSettings);
             
             // Merge the changes into the local siteSettings
             Object.assign(siteSettings, message.siteSettings);
             console.log("Updated local siteSettings:", siteSettings);
             
             // Save to sessionStorage as backup
             try {
                 for (const key in message.siteSettings) {
                     const value = message.siteSettings[key];
                     window.sessionStorage.setItem(`target_module_${key}`, String(value));
                     console.log(`Backed up ${key}=${value} to sessionStorage`);
                 }
             } catch (e) {
                 console.warn("Could not save settings to sessionStorage:", e);
             }

             // If 'enabled' changed, update the effective enabled state
             if (message.siteSettings.hasOwnProperty('enabled')) {
                 const oldIsEnabled = isEnabled;
                 isEnabled = siteSettings.enabled === true;
                 console.log(`Target enabled setting update: Site=${siteSettings.enabled}, Effective=${isEnabled}`);
                 if (oldIsEnabled && !isEnabled) cleanup();
                 else if (!oldIsEnabled && isEnabled) onActivate();
             }
             
             // If quantity changed, log it
             if (message.siteSettings.hasOwnProperty('quantity')) {
                 console.log(`Target quantity updated to: ${siteSettings.quantity}`);
             }
             
             // If profileId changed, reload profile
             if (message.siteSettings.hasOwnProperty('profileId')) {
                 console.log(`Target profile ID updated to: ${siteSettings.profileId}`);
                 loadSettingsAndProfile(); // Reload profile based on new ID
             }
             
             // Respond to confirm receipt of the settings
             sendResponse({ success: true, received: message.siteSettings });
             return true; // Keep the messaging channel open for async response
          }


          // Handle global setting updates
          if (message.action === 'updateGlobalSetting') {
             console.log(`Target global setting update received in content script:`, message.globalSettings);
             // Merge the changes into the local globalSettings
             Object.assign(globalSettings, message.globalSettings);
             console.log("Updated local globalSettings:", globalSettings);
          }


          // Handle profile updates from options page
          if (message.action === 'profileUpdated' || message.action === 'profileSelected') {
              console.log("Target detected profile update/selection.");
              loadSettingsAndProfile(); // Reload profile
          }


          if (asyncResponse) {
              return true; // Keep port open
          }
        });
        console.log("Target message listeners set up.");
      }

      /**
       * Detect the current page type based on URL
       * @returns {string} 'product', 'checkout', 'cart', or 'unknown'
       */
      function detectCurrentPage() {
        const currentUrl = window.location.href;
        let pageType = 'unknown';

        try {
          // Check for product pages - handle different URL formats
          if (currentUrl.includes('target.com/p/')) {
            pageType = 'product';
          }
          // Handle gift registry path that's causing errors
          else if (currentUrl.includes('/gift-registry')) {
            pageType = 'registry'; // Add new type for registry pages
          }
          // Handle checkout and cart paths
          else if (currentUrl.includes('target.com/checkout')) {
            pageType = 'checkout';
          }
          // Use exact pathname match for cart detection
          else if (window.location.pathname === '/cart') {
            pageType = 'cart';
          }

          console.log(`Detected Target page type: ${pageType} for URL: ${currentUrl}`);
        } catch (e) {
          console.error("Error detecting page type:", e);
        }

        return pageType;
      }

      /**
       * Handle page detection trigger (from background or initial load)
       * @param {string} pageType - Type of page detected
       */
      function handlePageDetection(pageType) {
        console.log(`Handling detected page type: ${pageType}. Enabled: ${isEnabled}`);
        cleanup(); // Cleanup state from previous page first

        // Skip processing for cart pages completely
        if (pageType === 'cart') {
          console.log("Cart page detected - checkout automation is disabled for cart pages");
          utils.updateStatus('Cart page detected (automation disabled)', 'status-waiting');
          return; // Early exit without processing cart pages
        }

        try {
          // First check if there's a previously interrupted checkout in progress
          // We may want to recover from navigational errors
          const isTargetProductPage = window.location.href.includes('target.com/p/');
          
          if (isEnabled) {
            if (pageType === 'product') {
              utils.updateStatus('Ready on product page', 'status-running');
              
              // Initialize and load settings first to ensure we have the latest
              loadSettingsAndProfile().then(() => {
                console.log("Settings loaded, preparing to start checkout process");
                
                // Streamlined initialization with parallel operations
                const initiateCheckout = () => {
                  console.log("Starting checkout process immediately");
                  try {
                    // Start checkout process immediately with error handling
                    startCheckoutProcess(true) // Pass true to skip reloading settings
                      .catch(error => {
                        // Special handling for route lookup errors
                        if (error && error.message && error.message.includes("lookup route")) {
                          console.warn("Route lookup error detected, attempting to continue anyway:", error.message);
                          utils.updateStatus('Working around route error...', 'status-running');
                          
                          // Try one more time with minimal delay
                          setTimeout(() => {
                            startCheckoutProcess(true).catch(handleCheckoutError);
                          }, 300); // Reduced delay for faster recovery
                        } else {
                          // Handle other errors normally
                          handleCheckoutError(error);
                        }
                      });
                  } catch (e) {
                    console.error("Error starting checkout process:", e);
                    handleCheckoutError(e);
                  }
                };
                
                // Start checkout process immediately if document is ready
                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                  console.log("Page already loaded, starting checkout immediately");
                  initiateCheckout();
                } else {
                  // Add event listener for DOMContentLoaded for faster checkout
                  console.log("Page still loading, waiting for DOMContentLoaded event");
                  window.addEventListener('DOMContentLoaded', () => {
                    console.log("DOMContentLoaded fired, starting checkout");
                    initiateCheckout();
                  }, { once: true });
                  
                  // Fallback timer in case event doesn't fire
                  setTimeout(initiateCheckout, 300);
                }
              }).catch(e => {
                console.error("Failed to load settings:", e);
                utils.updateStatus('Error loading settings', 'status-waiting');
              });
            } else if (pageType === 'checkout') {
              utils.updateStatus('Continuing on checkout page', 'status-running');
              setupCheckoutPageObservers(); // Setup watchers for this specific page load
              
              // Load settings first to ensure we have the latest
              loadSettingsAndProfile().then(() => {
                console.log("Settings loaded, preparing to continue checkout process");
                setTimeout(() => continueCheckoutProcess().catch(handleCheckoutError), 800);
              }).catch(e => {
                console.error("Failed to load settings:", e);
                utils.updateStatus('Error loading settings', 'status-waiting');
              });
            } else if (pageType === 'registry') {
              // Special handling for gift registry pages
              utils.updateStatus('Gift registry page detected (not supported)', 'status-waiting');
              console.log("Gift registry pages are not supported for checkout automation");
            } else {
              utils.updateStatus('On non-targetable Target page', 'status-waiting');
            }
          } else {
            const statusMap = {
              'product': 'Product page detected (Disabled)',
              'checkout': 'Checkout page detected (Disabled)',
              'registry': 'Gift registry page detected (not supported)',
              'unknown': 'Non-targetable Target page'
            };
            utils.updateStatus(statusMap[pageType] || statusMap['unknown'], 'status-waiting');
          }
        } catch (e) {
          console.error("Error in handlePageDetection:", e);
          utils.updateStatus('Error handling page detection', 'status-waiting');
        }
      }

      /**
       * Called when the extension is activated for this site
       */
      function onActivate() {
        console.log("Target checkout activated");

        // Skip activation for cart pages
        if (window.location.pathname === '/cart') {
          console.log("Cart page detected in onActivate() - checkout automation disabled for cart pages");
          utils.updateStatus('Cart page detected (automation disabled)', 'status-waiting');
          return;
        }

        // Reload settings in case they changed while inactive
        loadSettingsAndProfile().then(() => {
            const pageType = detectCurrentPage();
            if (pageType !== 'cart') { // Double-check to avoid cart processing
              handlePageDetection(pageType); // This will check the now current isEnabled state
            }
        });
      }

      /**
       * Clean up any active processes, observers, intervals
       */
      function cleanup() {
        console.log("Cleaning up Target checkout processes");
        checkoutInProgress = false;
        currentStep = '';
        placeOrderButtonClicked = false; // Reset critical flags
        confirmButtonClicked = false;
        verifyCardButtonClicked = false;
        isFillingCardInput = false;
        isFillingCvvInput = false;
        observers.forEach(observer => {
            if (observer && typeof observer.disconnect === 'function') {
                try { observer.disconnect(); } catch (e) { console.warn("Error disconnecting observer:", e); }
            }
        });
        observers = [];
        intervals.forEach(intervalId => clearInterval(intervalId));
        intervals = [];
        console.log("Target observers/intervals cleaned.");
      }

      // --- Checkout Flow ---

      /** Generic error handler */
      function handleCheckoutError(error) {
          console.error(`Checkout process error during step '${currentStep}':`, error);
          utils.updateStatus(`Error: ${error.message}`, 'status-waiting');
          checkoutInProgress = false; // Ensure progress flag is reset on error
      }

      // --- CHECKOUT STEP IMPLEMENTATIONS ---

      /**
       * Get TCIN/SKU from the product page using only URL extraction for efficiency
       * @returns {string|null} The TCIN/SKU if found, otherwise null
       */
      function extractTCIN() {
        try {
          console.log('🔍 Starting TCIN extraction (URL method only)');
          
          // Extract directly from URL - this has proven to be the most reliable method
          const urlMatch = window.location.pathname.match(/\/p\/.*?-\/A-(\d+)/);
          if (urlMatch && urlMatch[1]) {
            console.log(`🔍 Extracted TCIN from URL: ${urlMatch[1]}`);
            return urlMatch[1];
          }
          
          // If URL extraction fails, try data-tcin attribute as fallback
          const tcinElements = document.querySelectorAll('[data-tcin]');
          if (tcinElements.length > 0) {
            const tcinValue = tcinElements[0].getAttribute('data-tcin');
            console.log(`🔍 Found TCIN in data-tcin attribute: ${tcinValue}`);
            return tcinValue;
          }
          
          console.warn('⚠️ Could not find TCIN from URL or data attribute');
          return null;
        } catch (error) {
          console.error('❌ Error extracting TCIN:', error);
          console.error('❌ Stack trace:', error.stack);
          return null;
        }
      }
      
      /**
       * Extract the price from the product page
       * @returns {number|null} The price as a number if found, otherwise null
       */
      function extractPrice() {
        try {
          console.log('🔍 Starting price extraction');
          
          // Primary method: Look for the price element by data-test attribute
          const priceElement = document.querySelector('[data-test="product-price"]');
          console.log('🔍 Primary price element found:', priceElement ? 'Yes' : 'No');
          
          if (priceElement) {
            const priceText = priceElement.textContent.trim();
            console.log('🔍 Price element text:', priceText);
            
            // Remove dollar sign and convert to number
            const price = parseFloat(priceText.replace('$', ''));
            if (!isNaN(price)) {
              console.log(`🔍 Successfully extracted price: $${price}`);
              return price;
            } else {
              console.log('🔍 Price text could not be converted to a number');
            }
          }
          
          // Fallback: Look for any element that might contain a price
          console.log('🔍 Trying fallback price selectors');
          const potentialPriceElements = Array.from(document.querySelectorAll('.styles__PriceFontSize-sc-x06r9i-0, .h-text-bold'));
          console.log('🔍 Fallback price elements found:', potentialPriceElements.length);
          
          if (potentialPriceElements.length > 0) {
            console.log('🔍 Fallback element texts:', potentialPriceElements.map(el => el.textContent.trim()));
          }
          
          for (const el of potentialPriceElements) {
            const priceText = el.textContent.trim();
            console.log('🔍 Checking potential price text:', priceText);
            
            if (priceText.startsWith('$')) {
              const price = parseFloat(priceText.replace('$', ''));
              if (!isNaN(price)) {
                console.log(`🔍 Found price via fallback: $${price}`);
                return price;
              }
            }
          }
          
          // Additional fallback: Try to find price in structured data
          console.log('🔍 Trying to extract price from structured data');
          const structuredData = document.querySelector('script[type="application/ld+json"]');
          if (structuredData) {
            try {
              const jsonData = JSON.parse(structuredData.textContent);
              console.log('🔍 Structured data found:', jsonData.hasOwnProperty('offers') ? 'Has offers' : 'No offers');
              
              if (jsonData.offers && jsonData.offers.price) {
                const price = parseFloat(jsonData.offers.price);
                if (!isNaN(price)) {
                  console.log(`🔍 Found price in structured data: $${price}`);
                  return price;
                }
              }
            } catch (jsonError) {
              console.log('🔍 Error parsing structured data:', jsonError.message);
            }
          }
          
          console.warn('⚠️ Could not find price on product page after trying all methods');
          return null;
        } catch (error) {
          console.error('❌ Error extracting price:', error);
          console.error('❌ Stack trace:', error.stack);
          return null;
        }
      }
      
      // Add a flag to track if we've shown an alert already
      let priceCheckAlertShown = false;

      /**
       * Check if the current product passes price check
       * @returns {Promise<boolean>} True if price check passes or not applicable, false if it fails
       */
      async function checkProductPrice() {
        try {
          console.log('🔍 Price check starting...');
          
          // Force reload settings to ensure we have the latest
          const data = await storage.getFromStorage([
            'price_check_enabled',
            'price_check_closeTabOnFail',
            'price_check_items'
          ]);
          
          const price_check_enabled = data.price_check_enabled === true;
          const price_check_closeTabOnFail = data.price_check_closeTabOnFail === true;
          const price_check_items = data.price_check_items || {};
          
          console.log('🔍 Price check settings loaded:', {
            price_check_enabled,
            price_check_closeTabOnFail,
            num_items: Object.keys(price_check_items).length,
            item_keys: Object.keys(price_check_items)
          });
          
          // If price checking is not enabled, always pass
          if (!price_check_enabled) {
            console.log('🔍 Price check is disabled, skipping price verification');
            return true;
          }
          
          // Extract TCIN and price with enhanced debugging
          const tcin = extractTCIN();
          console.log('🔍 Extracted TCIN:', tcin);
          
          // Log DOM details for debugging TCIN extraction
          const tcinLabels = document.querySelectorAll('div b');
          console.log('🔍 TCIN labels found:', tcinLabels.length);
          if (tcinLabels.length > 0) {
            console.log('🔍 TCIN label texts:', Array.from(tcinLabels).map(el => el.textContent.trim()));
          }
          
          // Check metadata for TCIN
          const metaTCIN = document.querySelector('meta[name="productId"]');
          console.log('🔍 Meta TCIN element found:', metaTCIN ? 'Yes' : 'No');
          if (metaTCIN) {
            console.log('🔍 Meta TCIN value:', metaTCIN.content);
          }
          
          const price = extractPrice();
          console.log('🔍 Extracted price:', price);
          
          // Log DOM details for debugging price extraction
          const priceElements = document.querySelectorAll('[data-test="product-price"]');
          console.log('🔍 Price elements found:', priceElements.length);
          if (priceElements.length > 0) {
            console.log('🔍 Price element texts:', Array.from(priceElements).map(el => el.textContent.trim()));
          }
          
          // Log fallback price elements
          const fallbackPriceElements = document.querySelectorAll('.styles__PriceFontSize-sc-x06r9i-0, .h-text-bold');
          console.log('🔍 Fallback price elements found:', fallbackPriceElements.length);
          if (fallbackPriceElements.length > 0) {
            console.log('🔍 Fallback price texts:', Array.from(fallbackPriceElements).map(el => el.textContent.trim()));
          }
          
          if (!tcin) {
            console.warn('⚠️ Could not perform price check: TCIN not found on page');
            console.warn('⚠️ DOM elements checked:', document.querySelectorAll('div b').length);
            
            // Document HTML structure around where TCIN should be
            console.log('🔍 HTML structure near where TCIN should be:');
            const potentialContainers = document.querySelectorAll('.ProductDetailsLayout');
            if (potentialContainers.length > 0) {
              console.log('🔍 Product details containers found:', potentialContainers.length);
              console.log('🔍 First container HTML snippet:', potentialContainers[0].innerHTML.substring(0, 500) + '...');
            } else {
              console.log('🔍 Product details containers not found');
            }
            
            return true; // Pass if we can't find the TCIN
          }
          
          if (!price) {
            console.warn('⚠️ Could not perform price check: Price not found on page');
            console.warn('⚠️ Price elements available:', document.querySelectorAll('[data-test="product-price"]').length);
            
            // Document HTML structure around where price should be
            console.log('🔍 HTML structure near where price should be:');
            const potentialPriceContainers = document.querySelectorAll('.styles__PriceDetailsWrapper-sc-1iuiv4s-0, .styles__PriceFontSize-sc-x06r9i-0');
            if (potentialPriceContainers.length > 0) {
              console.log('🔍 Price containers found:', potentialPriceContainers.length);
              console.log('🔍 First container HTML snippet:', potentialPriceContainers[0].innerHTML.substring(0, 500) + '...');
            } else {
              console.log('🔍 Price containers not found');
            }
            
            return true; // Pass if we can't find the price
          }
          
          // Debug all saved price check items
          console.log('🔍 All saved price check items:', JSON.stringify(price_check_items, null, 2));
          console.log('🔍 Checking if TCIN exists in price_check_items:', tcin in price_check_items);
          
          // Check if this TCIN has a price limit
          if (tcin in price_check_items) {
            const maxPrice = price_check_items[tcin];
            console.log(`🔍 Price check: Comparing price $${price} with max $${maxPrice} for TCIN ${tcin}`);
            
            if (price > maxPrice) {
              utils.updateStatus(`Price check failed: $${price} exceeds max $${maxPrice}`, 'status-waiting');
              console.error(`❌ PRICE CHECK FAILED: $${price} exceeds maximum price $${maxPrice} for TCIN ${tcin}`);
              
              // First log the price check failure
              console.error('------------- CHECKOUT BLOCKED BY PRICE CHECK -------------');
              
              // If closeTabOnFail is enabled, close the tab immediately without showing alert
              if (price_check_closeTabOnFail) {
                console.log('🔍 Price check failed - Closing tab immediately');
                
                // Try to close tab using multiple methods for better reliability
                try {
                  // First attempt - direct close
                  window.close();
                  
                  // Second attempt (backup) with very short timeout
                  setTimeout(() => {
                    try {
                      window.close();
                    } catch (e) {
                      console.error('Failed second close attempt:', e);
                    }
                  }, 50);
                  
                } catch (e) {
                  console.error('Failed to close tab:', e);
                  // If tab close fails, show alert as fallback
                  if (!priceCheckAlertShown) {
                    priceCheckAlertShown = true;
                    alert(`Price check failed: $${price} exceeds your maximum price of $${maxPrice} for this item.`);
                  }
                }
              } else {
                // If not closing tab, just show the alert once
                if (!priceCheckAlertShown) {
                  priceCheckAlertShown = true;
                  alert(`Price check failed: $${price} exceeds your maximum price of $${maxPrice} for this item.`);
                }
              }
              
              return false; // Price check failed - block checkout
            } else {
              utils.updateStatus(`Price check passed: $${price} <= max $${maxPrice}`, 'status-running');
              console.log(`✅ Price check passed: $${price} is under or equal to maximum price $${maxPrice} for TCIN ${tcin}`);
              return true; // Price check passed
            }
          } else {
            console.log(`🔍 No price check rule for TCIN ${tcin} - continuing checkout`);
            return true; // No restriction for this TCIN
          }
        } catch (error) {
          console.error('❌ Error during price check:', error);
          console.error('❌ Stack trace:', error.stack); // Log the full stack trace
          utils.updateStatus(`Price check error: ${error.message}`, 'status-waiting');
          
          // Log any context that might help debug the error
          console.log('🔍 Error context - URL:', window.location.href);
          console.log('🔍 Error context - DOM ready state:', document.readyState);
          
          // Changed: Don't automatically pass on error - stop checkout to be safe
          return false;
        }
      }

      /**
       * Check if critical elements for checkout are ready on the page (optimized)
       * @returns {boolean} True if critical elements are available
       */
      function areCriticalElementsReady() {
        try {
          // Focus only on the Add to Cart button which is most critical
          // and appears last in the rendering process
          const addToCartButton = finder.findElementWithSelectors(selectors.productPageSelectors.addToCart);
          const isReady = addToCartButton && finder.isElementVisible(addToCartButton);
          
          if (isReady) {
            console.log("Add to cart button is ready");
          }
          
          return isReady;
        } catch (error) {
          console.log("Error checking critical elements:", error);
          return false;
        }
      }

      /**
       * Start the checkout process from the product page (optimized for speed)
       * @param {boolean} skipSettingsReload - If true, skip reloading settings
       */
      async function startCheckoutProcess(skipSettingsReload = false) {
        if (checkoutInProgress) { console.log("Checkout already in progress..."); return; }
        
        // Set flag immediately to prevent duplicate starts
        checkoutInProgress = true;
        utils.updateStatus('Starting checkout...', 'status-running');
        currentStep = 'start';
        
        // Try-catch the entire loading process to prevent route lookup errors from stopping checkout
        try {
            // Only reload settings if not skipped (improves performance)
            if (!skipSettingsReload) {
                await loadSettingsAndProfile(); // Ensure latest profile/settings
            }
            
            // Verify profile
            if (!profile) { 
                utils.updateStatus("Error: No profile selected", "status-waiting"); 
                throw new Error('Cannot start checkout: No profile selected.'); 
            }
            
            // Check if enabled
            if (!isEnabled) { 
                console.log("Checkout start aborted: Extension disabled."); 
                checkoutInProgress = false; // Reset flag
                return;
            }
            
            // Start price check but don't block immediate progress - async check
            const priceCheckPromise = checkProductPrice();
            
            // Start checking stock status immediately in parallel
            let stockCheckPromise = new Promise(async (resolve, reject) => {
                try {
                    currentStep = 'check-stock';
                    console.log("Checking stock status...");
                    const oosElement = finder.findElementWithSelectors(selectors.productPageSelectors.outOfStock);
                    if (oosElement && finder.isElementVisible(oosElement)) {
                        reject(new Error("Item is out of stock."));
                    } else {
                        resolve();
                    }
                } catch (error) {
                    // Only reject if it's an "out of stock" error
                    if (error.message && error.message.includes("out of stock")) {
                        reject(error);
                    } else {
                        console.warn(`Non-critical error in check-stock step: ${error.message}. Continuing anyway.`);
                        resolve();
                    }
                }
            });
            
            // Wait for both checks to complete
            const [priceCheckPassed] = await Promise.all([
                priceCheckPromise,
                stockCheckPromise
            ]);
            
            if (!priceCheckPassed) {
                console.log("Checkout aborted due to price check failure");
                checkoutInProgress = false; // Reset flag
                return;
            }

            try {
                // Minimize sleep delays and run steps more efficiently
                try {
                    currentStep = 'select-delivery';
                    console.log("Selecting delivery method...");
                    await selectDeliveryMethod(); // Simplified - no longer takes preference
                    // Minimal sleep time
                    await utils.sleep(globalSettings.randomizeDelay ? utils.sleep(150, true) : 150);
                } catch (error) {
                    console.warn(`Error in select-delivery step: ${error.message}. Continuing anyway.`);
                }

                try {
                    currentStep = 'add-to-cart';
                    console.log("Adding item to cart...");
                    await addToCart(); // Includes setQuantity
                    // Minimal sleep time
                    await utils.sleep(150);
                } catch (error) {
                    // This step is critical - must rethrow
                    console.error("Critical error in add-to-cart step:", error);
                    throw error;
                }

                try {
                    currentStep = 'handle-popups';
                    console.log("Handling popups...");
                    await handlePopups();
                } catch (error) {
                    console.warn(`Error handling popups: ${error.message}. Continuing anyway.`);
                }

                currentStep = 'go-to-checkout';
                console.log("Proceeding to checkout...");
                await goDirectlyToCheckout(); // Navigates away
            } catch (error) { 
                handleCheckoutError(error); 
            }
            // No finally block resetting checkoutInProgress, handled by cleanup on next page
        } catch (error) {
            // Log but don't handle critical setup errors
            console.error(`Critical error before checkout could begin: ${error.message}`);
            utils.updateStatus(`Error: ${error.message}`, 'status-waiting');
            checkoutInProgress = false;
        }
      }

      /** Action to take when on the cart page - completely disabled */
      async function proceedFromCart() {
        // This function should not be called anymore due to our cart page detection
        console.log("proceedFromCart called but all cart page processing is disabled");
        return;
      }

      /** Continue checkout on checkout page */
      async function continueCheckoutProcess() {
        if (checkoutInProgress) { console.log("Checkout continuation already in progress."); return; }
        await loadSettingsAndProfile();
        if (!profile) { utils.updateStatus('Error: No profile for checkout', 'status-waiting'); throw new Error('Cannot continue checkout: No profile selected.'); }
        if (!isEnabled) { console.log("Continue checkout aborted: Extension disabled."); return;}

        checkoutInProgress = true;
        utils.updateStatus('Continuing checkout...', 'status-running');
        currentStep = 'continue-checkout';

        try {
            console.log("Determining current step on checkout page...");

            // Always wait a moment for the page to stabilize
            await utils.sleep(500);

            // Safer loading detection with error handling
            try {
                currentStep = 'wait-for-load';
                console.log("Checking for loading indicators...");

                // Make sure the loadingSpinner selector is defined and is an array
                const spinnerSelectors = selectors.checkoutPageSelectors.loadingSpinner;
                if (Array.isArray(spinnerSelectors)) {
                    const loader = finder.findElementWithSelectors(spinnerSelectors);
                    if (loader && finder.isElementVisible(loader)) {
                        console.log("Checkout page loading detected, waiting...");
                        await utils.sleep(2000); // Wait longer if loading
                        checkoutInProgress = false; // Allow re-entry
                        await continueCheckoutProcess(); // Re-run after waiting
                        return;
                    }
                }
            } catch (error) {
                console.warn("Loading detection error (continuing anyway):", error);
                // Continue with checkout even if loading detection fails
            }

            // Prioritize checks: CVV/Card Verification > Place Order > Payment > Shipping
            currentStep = 'check-cvv';
            if (finder.findElementWithSelectors(selectors.checkoutPageSelectors.cvvVerification.input)) {
                console.log("CVV input detected.");
                await handleCVVConfirmation(); await utils.sleep(1500); await placeOrder();
            } else {
                currentStep = 'check-card-verify';
                if (finder.findElementWithSelectors(selectors.checkoutPageSelectors.cardVerification.input)) {
                    console.log("Card verification input detected.");
                    await handleCreditCardConfirmation(); await utils.sleep(1500); await placeOrder();
                } else {
                    currentStep = 'check-place-order';
                    if (document.querySelector(selectors.checkoutPageSelectors.placeOrderButton)) {
                        console.log("Place Order button detected.");
                        await placeOrder();
                    } else {
                        currentStep = 'check-payment-form';
                        if (finder.findElementWithSelectors(selectors.checkoutPageSelectors.paymentForm)) {
                            console.log("Payment form detected.");
                            await fillPaymentInfo(); await utils.sleep(1500); await placeOrder();
                        } else {
                            currentStep = 'check-shipping-form';
                            if (finder.findElementWithSelectors(selectors.checkoutPageSelectors.shippingForm)) {
                                console.log("Shipping form detected.");
                                await fillShippingInfo(); await utils.sleep(1500);
                                await fillPaymentInfo(); await utils.sleep(1500);
                                await placeOrder();
                            } else {
                                currentStep = 'fallback-check';
                                console.log("Could not determine specific checkout step, trying payment info fill as fallback.");
                                await fillPaymentInfo(); await utils.sleep(1500); await placeOrder();
                            }
                        }
                    }
                }
            }
        } catch (error) { handleCheckoutError(error); }
        finally { checkoutInProgress = false; } // Reset flag after attempt
      }

      /** Select delivery method */
      async function selectDeliveryMethod() {
        currentStep = 'select-delivery';
        // Removed deliveryPreference logic - always use default/first available
        console.log("Using default delivery method (first available).");
        // No action needed as 'first-available' is usually the default state
        return;
      }

      /** Set quantity */
      async function setQuantity() {
          currentStep = 'set-quantity';
          const targetQty = siteSettings.quantity;
          // Removed useMax variable and logic

          // Only proceed if targetQty > 1
          if (targetQty <= 1) {
              console.log("Default quantity (1).");
              return;
          }

          utils.updateStatus(`Setting quantity: ${targetQty}`, 'status-running'); // Simplified status
          const qtySelectors = selectors.productPageSelectors.quantity;
          const incBtn = document.querySelector(qtySelectors.stepper.increment);
          const decBtn = document.querySelector(qtySelectors.stepper.decrement);
          const valEl = document.querySelector(qtySelectors.stepper.value);

          if (incBtn && valEl) { // Stepper Logic
              console.log("Using quantity stepper.");
              const currentVal = parseInt(valEl.textContent?.trim() || '1');
              // Removed useMax block
              // Logic for specific targetQty
              const clicks = targetQty - currentVal;
              const btn = clicks > 0 ? incBtn : (clicks < 0 ? decBtn : null);
              if (btn) {
                  for (let i = 0; i < Math.abs(clicks); i++) {
                      if (finder.isElementDisabled(btn)) break;
                      await utils.clickElement(btn, clicks > 0 ? 'qty-inc' : 'qty-dec');
                      await utils.sleep(globalSettings.randomizeDelay ? utils.sleep(150, true) : 150);
                  }
              }
              await utils.sleep(200);
              return;
          }

          const dropdownTrigger = finder.findElementWithSelectors(qtySelectors.dropdown);
          if (dropdownTrigger) { // Dropdown Logic
              console.log("Using quantity dropdown.");
              if (dropdownTrigger.tagName === 'SELECT') {
                  const options = Array.from(dropdownTrigger.options);
                  // Removed useMax logic
                  const opt = options.find(o => o.value === String(targetQty) || o.textContent.trim() === String(targetQty));
                  if (opt && dropdownTrigger.value !== opt.value) {
                      dropdownTrigger.value = opt.value;
                      dropdownTrigger.dispatchEvent(new Event('change', { bubbles: true }));
                      await utils.sleep(globalSettings.randomizeDelay ? utils.sleep(400, true) : 400);
                  } else if (!opt) {
                      console.warn(`Qty ${targetQty} not found.`); // Simplified warning
                  }
              } else { // Custom Dropdown
                  await utils.clickElement(dropdownTrigger, 'qty-dd-trigger');
                  await utils.sleep(globalSettings.randomizeDelay ? utils.sleep(500, true) : 500);
                  let optsEls = document.querySelectorAll(qtySelectors.dropdownOptions) || document.querySelectorAll(qtySelectors.genericDropdownOptions);
                  if (optsEls.length > 0) {
                      const optsArr = Array.from(optsEls);
                      // Removed useMax logic
                      const targetOptEl = optsArr.find(o => (o.textContent || o.getAttribute('aria-label') || '').trim() === String(targetQty));
                      if (targetOptEl) {
                          await utils.clickElement(targetOptEl, `qty-opt-${targetQty}`); // Simplified ID
                          await utils.sleep(globalSettings.randomizeDelay ? utils.sleep(400, true) : 400);
                      } else {
                          console.warn(`Qty option ${targetQty} not found.`); // Simplified warning
                      }
                  } else {
                      console.warn("No dropdown options found.");
                  }
              }
              return;
          }
          console.log("Quantity selector not found.");
      }

      /**
       * Find the Buy Now iframe by its unique attributes or content
       * @returns {Promise<HTMLIFrameElement|null>} - The Buy Now iframe or null if not found
       */
      async function findBuyNowIframe() {
        console.log("Finding Buy Now iframe...");
        
        // Get all iframes in the document
        const iframes = Array.from(document.querySelectorAll('iframe'));
        console.log(`Found ${iframes.length} iframes in the document`);
        
        if (iframes.length === 0) {
          return null;
        }

        // First, try to find by ID (most reliable)
        const buyNowIdFrame = iframes.find(iframe => iframe.id === 'buy-now-iframe');
        if (buyNowIdFrame) {
          console.log("Found Buy Now iframe by ID");
          return buyNowIdFrame;
        }
        
        // Then, try to find by source URL pattern
        const buyNowSrcFrame = iframes.find(iframe => 
          iframe.src && (
            iframe.src.includes('/checkout/buy-now') || 
            iframe.src.includes('/buy-now/checkout')
          )
        );
        if (buyNowSrcFrame) {
          console.log("Found Buy Now iframe by source URL");
          return buyNowSrcFrame;
        }
        
        // Try to find by checking iframe content (if accessible)
        for (let i = 0; i < iframes.length; i++) {
          try {
            const iframe = iframes[i];
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            
            if (!iframeDoc) {
              continue; // Skip iframes we can't access (cross-origin)
            }
            
            // Check for typical Buy Now panel content
            const hasPlaceOrderButton = !!iframeDoc.querySelector('[data-test="placeOrderButton"]');
            const hasConfirmOrderHeading = Array.from(iframeDoc.querySelectorAll('h2')).some(h => 
              h.textContent && h.textContent.includes('Confirm your order')
            );
            
            if (hasPlaceOrderButton || hasConfirmOrderHeading) {
              console.log(`Found Buy Now iframe by content inspection at index ${i}`);
              return iframe;
            }
          } catch (error) {
            console.log(`Cannot access iframe ${i} content:`, error.message);
          }
        }
        
        console.warn("Could not find Buy Now iframe by any method");
        return null;
      }
      
      /**
       * Helper function to interact with the Buy Now iframe
       * @param {Function} callback - Function to execute within the iframe context
       * @returns {Promise<any>} - Result of the callback or null if iframe access fails
       */
      async function withBuyNowIframe(callback) {
        try {
          // Find the Buy Now iframe
          const iframe = await findBuyNowIframe();
          if (!iframe) {
            console.warn("Buy Now iframe not found");
            return null;
          }
          
          // Try to access iframe content
          const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
          
          if (!iframeDocument) {
            console.warn("Cannot access Buy Now iframe document (possible cross-origin restriction)");
            return null;
          }
          
          // Execute callback with iframe document as context
          return await callback(iframeDocument, iframe);
        } catch (error) {
          console.error("Error while working with Buy Now iframe:", error);
          return null;
        }
      }
      
      /**
       * Find an element inside the Buy Now iframe
       * @param {string} selector - CSS selector for the element
       * @returns {Promise<Element|null>} - The element or null if not found
       */
      async function findInBuyNowIframe(selector) {
        return await withBuyNowIframe((doc) => {
          // Try various methods to find the element
          let element = null;
          
          // Method 1: Direct selector
          element = doc.querySelector(selector);
          if (element) {
            console.log(`Found element with selector "${selector}" directly`);
            return element;
          }
          
          console.log(`Element not found with selector "${selector}", trying alternatives...`);
          
          // Method 2: Data-test attribute (for Place Order button)
          if (selector.includes('placeOrderButton') || selector.includes('Place your order')) {
            // Try by data-test attribute
            element = doc.querySelector('[data-test="placeOrderButton"]');
            if (element) {
              console.log('Found Place Order button by data-test attribute');
              return element;
            }
            
            // Try by button text
            const buttons = Array.from(doc.querySelectorAll('button'));
            element = buttons.find(btn => 
              btn.textContent && btn.textContent.trim() === 'Place your order'
            );
            if (element) {
              console.log('Found Place Order button by exact text match');
              return element;
            }
            
            // Try by class name based on the exact button markup shared
            element = doc.querySelector('button.styles_ndsBaseButton__W8Gl7.styles_ndsButton__XOOOH');
            if (element) {
              console.log('Found Place Order button by exact class combination');
              return element;
            }
            
            // Try by any button with "Place" text as last resort
            element = buttons.find(btn => 
              btn.textContent && btn.textContent.toLowerCase().includes('place')
            );
            if (element) {
              console.log('Found Place Order button by partial text match');
              return element;
            }
            
            // Log all buttons for debugging
            console.log('Place Order button not found, logging all buttons:');
            buttons.forEach((btn, i) => {
              console.log(`Button ${i}:`, {
                text: btn.textContent?.trim(),
                classes: btn.className,
                dataTest: btn.getAttribute('data-test'),
                html: btn.outerHTML.substring(0, 100) + (btn.outerHTML.length > 100 ? '...' : '')
              });
            });
          }
          
          // Method 3: For CVV input
          if (selector.includes('enter-cvv') || selector === '#enter-cvv') {
            // Try by ID
            element = doc.getElementById('enter-cvv');
            if (element) {
              console.log('Found CVV input by ID');
              return element;
            }
            
            // Try by input type with "cvv" attribute
            const inputs = Array.from(doc.querySelectorAll('input'));
            element = inputs.find(input => 
              (input.type === 'tel' || input.type === 'text') && 
              (input.placeholder?.toLowerCase().includes('cvv') || 
               input.name?.toLowerCase().includes('cvv') ||
               input.getAttribute('aria-label')?.toLowerCase().includes('cvv'))
            );
            if (element) {
              console.log('Found CVV input by attributes');
              return element;
            }
          }
          
          // Method 4: For Confirm button
          if (selector.includes('confirm-button') || selector.includes('Confirm')) {
            // Try by data-test
            element = doc.querySelector('[data-test="confirm-button"]');
            if (element) {
              console.log('Found Confirm button by data-test attribute');
              return element;
            }
            
            // Try by button text
            const buttons = Array.from(doc.querySelectorAll('button'));
            element = buttons.find(btn => 
              btn.textContent && btn.textContent.trim().toLowerCase() === 'confirm'
            );
            if (element) {
              console.log('Found Confirm button by text');
              return element;
            }
          }
          
          // Method 5: For Close button
          if (selector.includes('close') || selector.includes('styles_body__kQRBi')) {
            // Try directly first
            element = doc.querySelector('div.styles_body__kQRBi button');
            if (element) {
              console.log('Found Close button by class selector');
              return element;
            }
            
            // Try by class
            element = doc.querySelector('button.styles_ndsButton__XOOOH');
            if (element) {
              console.log('Found Close button by button class');
              return element;
            }
            
            // Try by close text or X symbol
            const buttons = Array.from(doc.querySelectorAll('button'));
            element = buttons.find(btn => 
              (btn.textContent && btn.textContent.trim().toLowerCase() === 'close') ||
              (btn.textContent && btn.textContent.trim() === 'X') ||
              btn.getAttribute('aria-label')?.toLowerCase().includes('close')
            );
            if (element) {
              console.log('Found Close button by text/aria-label');
              return element;
            }
            
            // Try by SVG icon (close buttons often contain SVG icons)
            const svgButtons = Array.from(doc.querySelectorAll('button svg'));
            if (svgButtons.length > 0) {
              element = svgButtons[0].closest('button');
              if (element) {
                console.log('Found potential Close button by SVG content');
                return element;
              }
            }
          }
          
          console.warn(`Element with selector "${selector}" not found in Buy Now iframe after trying all methods`);
          return null;
        });
      }
      
      /**
       * Click an element inside the Buy Now iframe
       * @param {string} selector - CSS selector for the element to click
       * @param {string} actionName - Name for logging
       * @returns {Promise<boolean>} - True if click was successful
       */
      async function clickInBuyNowIframe(selector, actionName) {
        const element = await findInBuyNowIframe(selector);
        if (!element) return false;
        
        try {
          // Scroll element into view
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await utils.sleep(300);
          
          // We can't use utils.clickElement directly because it expects an element in the main document
          // Instead, we'll trigger events manually with a more robust approach
          element.focus();
          
          // Dispatch mousedown, mouseup events before click for better simulation
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          element.click();
          
          console.log(`Clicked "${actionName}" in Buy Now iframe`);
          return true;
        } catch (error) {
          console.error(`Failed to click "${actionName}" in Buy Now iframe:`, error);
          return false;
        }
      }
      
      /**
       * Fill an input field inside the Buy Now iframe
       * @param {string} selector - CSS selector for the input
       * @param {string} value - Value to fill
       * @param {string} actionName - Name for logging
       * @returns {Promise<boolean>} - True if filling was successful
       */
      async function fillInBuyNowIframe(selector, value, actionName) {
        const element = await findInBuyNowIframe(selector);
        if (!element) return false;
        
        try {
          // Focus the element first
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await utils.sleep(300);
          element.focus();
          
          // Clear existing value (multiple methods for reliability)
          element.value = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Set new value and trigger appropriate events
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          
          console.log(`Filled "${actionName}" with value "${value}" in Buy Now iframe`);
          return true;
        } catch (error) {
          console.error(`Failed to fill "${actionName}" in Buy Now iframe:`, error);
          return false;
        }
      }
      
      /**
       * Check if an element exists in the Buy Now iframe
       * @param {string} selector - CSS selector for the element
       * @returns {Promise<boolean>} - True if element exists and is visible
       */
      async function elementExistsInBuyNowIframe(selector) {
        const result = await withBuyNowIframe((doc) => {
          let element = doc.querySelector(selector);
          
          // If not found by direct selector, try alternative methods based on the type of element
          if (!element) {
            if (selector.includes('placeOrderButton')) {
              element = doc.querySelector('[data-test="placeOrderButton"]');
              
              if (!element) {
                const buttons = Array.from(doc.querySelectorAll('button'));
                element = buttons.find(btn => 
                  btn.textContent && btn.textContent.trim() === 'Place your order'
                );
              }
            } else if (selector === '#enter-cvv') {
              element = doc.getElementById('enter-cvv');
              
              if (!element) {
                const inputs = Array.from(doc.querySelectorAll('input'));
                element = inputs.find(input => 
                  input.placeholder?.toLowerCase().includes('cvv') || 
                  input.name?.toLowerCase().includes('cvv')
                );
              }
            }
          }
          
          return element && element.offsetParent !== null;
        });
        
        return !!result; // Convert to boolean
      }
      
      /**
       * Check for an error message in the Buy Now iframe
       * @returns {Promise<boolean>} - True if an error message is found
       */
      async function hasErrorInBuyNowIframe() {
        return await withBuyNowIframe((doc) => {
          // Check for error alert
          const errorAlert = doc.querySelector('div[role="alert"]');
          if (errorAlert && errorAlert.textContent.includes("We can't complete this order")) {
            return true;
          }
          
          // Check for other error messages
          const errorMessages = Array.from(doc.querySelectorAll('.error, .error-message, [class*="error"], [class*="Error"]'));
          return errorMessages.some(el => el.offsetParent !== null);
        }) || false;
      }

      /** 
       * Handle the Buy Now checkout flow using our content-detecting iframe approach
       * @param {HTMLElement} buyNowButton - The Buy Now button element
       * @returns {Promise<void>}
       */
      async function useBuyNowCheckout(buyNowButton) {
        currentStep = 'buy-now-checkout';
        utils.updateStatus('Using Buy Now checkout...', 'status-running');
        
        // Maximum number of retry attempts
        const maxRetries = 5;
        let retryCount = 0;
        
        // Function to actively poll for Buy Now button and retry checkout
        const retryBuyNow = async (initialDelayMs = 2000) => {
          if (retryCount >= maxRetries) {
            console.log(`Exceeded maximum retries (${maxRetries}), staying on product page`);
            utils.updateStatus('Buy now checkout failed, please try again', 'status-waiting');
            return;
          }
          
          retryCount++;
          console.log(`Beginning retry attempt ${retryCount}/${maxRetries} after ${initialDelayMs}ms initial delay`);
          await utils.sleep(initialDelayMs);
          
          // Actively poll for the Buy Now button to reappear
          console.log("Starting active polling for Buy Now button...");
          
          // Set up polling parameters
          const maxPollAttempts = 10;
          const pollIntervalMs = 500;
          let pollAttempts = 0;
          let buyNowButton = null;
          
          // Poll for the button with shorter intervals
          while (pollAttempts < maxPollAttempts) {
            pollAttempts++;
            console.log(`Polling for Buy Now button (attempt ${pollAttempts}/${maxPollAttempts})...`);
            
            // Look for the button using multiple selectors for better reliability
            buyNowButton = document.querySelector('[data-test="buy-now-button"]') ||
                          document.querySelector('button[data-test="buy-now-button"]') ||
                          Array.from(document.querySelectorAll('button')).find(btn => 
                            btn.textContent && btn.textContent.trim().toLowerCase().includes('buy now')
                          );
            
            if (buyNowButton && finder.isElementVisible(buyNowButton)) {
              console.log(`Found Buy Now button on poll attempt ${pollAttempts}!`);
              break;
            }
            
            // If button not found yet, wait a short time before next poll
            if (pollAttempts < maxPollAttempts) {
              await utils.sleep(pollIntervalMs);
            }
          }
          
          // If button found after polling, retry the Buy Now checkout
          if (buyNowButton && finder.isElementVisible(buyNowButton)) {
            console.log("Buy Now button found, restarting checkout flow");
            
            // Add a small pause to ensure UI is fully ready
            await utils.sleep(500);
            
            // Reset retry count for successful button finding
            retryCount = 0;
            
            try {
              // Ensure the error recovery flag is reset properly
              inBuyNowErrorRecovery = false;
              console.log("Error recovery flag reset before restarting Buy Now flow");
              
              return useBuyNowCheckout(buyNowButton);
            } catch (error) {
              console.error("Error restarting Buy Now checkout:", error);
              return retryBuyNow(Math.min(initialDelayMs * 1.5, 5000)); // Try again with increased delay
            }
          } else {
            console.log("Buy Now button not found after active polling, will retry with longer delay");
            return retryBuyNow(Math.min(initialDelayMs * 1.5, 5000)); // Exponential backoff, max 5 seconds
          }
        };
        
        try {
          // Step 1: Click the Buy Now button in the main document
          console.log("Clicking Buy Now button in main document");
          const clicked = await utils.clickElement(buyNowButton, 'buy-now');
          if (!clicked) { 
            throw new Error('Failed to click Buy Now button.'); 
          }
          
          // Wait for the side panel and iframe to appear
          console.log("Waiting for Buy Now side panel and iframe to appear");
          await utils.sleep(2000); // Increased delay to ensure iframe loads
          
          // Step 2: Click "Place your order" button inside the iframe
          console.log("Looking for Place your order button inside Buy Now iframe");
          let findAttempts = 0;
          const maxFindAttempts = 8; // Increased attempts
          
          let placeOrderFound = false;
          while (!placeOrderFound && findAttempts < maxFindAttempts) {
            findAttempts++;
            placeOrderFound = await elementExistsInBuyNowIframe('[data-test="placeOrderButton"]');
            
            if (!placeOrderFound) {
              console.log(`Place order button not found, attempt ${findAttempts}/${maxFindAttempts}`);
              await utils.sleep(1000);
            }
          }
          
          if (!placeOrderFound) {
            console.warn("Place your order button not found in Buy Now iframe after multiple attempts");
            return retryBuyNow(2500);
          }
          
          console.log("Clicking Place your order button in Buy Now iframe");
          const placeOrderClicked = await clickInBuyNowIframe('[data-test="placeOrderButton"]', 'place-order');
          if (!placeOrderClicked) {
            console.warn("Failed to click Place your order button");
            return retryBuyNow(1500);
          }
          
          // Wait for CVV input to appear
          console.log("Waiting for CVV input to appear in Buy Now iframe");
          await utils.sleep(1500);
          
          // Check if CVV input exists in the iframe
          const cvvExists = await elementExistsInBuyNowIframe('#enter-cvv');
          if (!cvvExists) {
            console.warn("CVV input not found in Buy Now iframe");
            return retryBuyNow(1500);
          }
          
          // Get the CVV from the profile
          let cvv = null;
          
          // Check all possible places where CVV might be stored
          if (profile?.cvv) {
            console.log("Using CVV from direct profile property");
            cvv = profile.cvv;
          } else if (profile?.paymentMethod?.cvv) {
            console.log("Using CVV from profile.paymentMethod structure");
            cvv = profile.paymentMethod.cvv;
          } else if (profile?.payment?.cvv) {
            console.log("Using CVV from profile.payment structure");
            cvv = profile.payment.cvv;
          }
          
          if (!cvv) {
            console.warn("No CVV found in profile (checked all structures), can't complete Buy Now checkout");
            // Log available profile structure to help debugging
            console.log("Profile data available:", {
              hasDirectCVV: !!profile?.cvv,
              hasPaymentMethod: !!profile?.paymentMethod,
              hasPayment: !!profile?.payment,
              profileKeys: profile ? Object.keys(profile) : []
            });
            return;
          }
          
          // Fill the CVV field in the iframe
          console.log("Filling CVV input in Buy Now iframe");
          const cvvFilled = await fillInBuyNowIframe('#enter-cvv', cvv, 'cvv');
          if (!cvvFilled) {
            console.warn("Failed to fill CVV input");
            return retryBuyNow(1500);
          }
          
          // Click the Confirm button in the iframe
          console.log("Clicking Confirm button in Buy Now iframe");
          await utils.sleep(500); // Small delay after filling CVV
          const confirmClicked = await clickInBuyNowIframe('[data-test="confirm-button"]', 'confirm-cvv');
          if (!confirmClicked) {
            console.warn("Failed to click Confirm button");
            return retryBuyNow(1500);
          }
          
          // Check for error message after confirming CVV
          await utils.sleep(1500);
          const hasError = await hasErrorInBuyNowIframe();
          
          if (hasError) {
            console.log("Error detected: Can't complete this order, will retry");
            
            // Set flag to prevent checkout redirection during error recovery
            inBuyNowErrorRecovery = true;
            console.log("Setting inBuyNowErrorRecovery flag to prevent checkout redirection");
            
            // Click the Close button in the iframe
            console.log("Clicking Close button in Buy Now iframe");
            const closeClicked = await clickInBuyNowIframe('div.styles_body__kQRBi button', 'close-error');
            if (!closeClicked) {
              // Try alternative selector
              await clickInBuyNowIframe('button.styles_ndsButton__XOOOH', 'close-error-alt');
            }
            
            // Wait for panel to close and Buy Now button to become available again
            await utils.sleep(3500); // Increased delay to ensure panel is fully closed
            
            // Reset the flag once we're done with error recovery
            setTimeout(() => {
              inBuyNowErrorRecovery = false;
              console.log("Reset inBuyNowErrorRecovery flag after error handling");
            }, 2000); // Increased timeout to 2 seconds
            
            return retryBuyNow(1500);
          } else {
            // No error, check for final confirmation button
            const finalButtonExists = await elementExistsInBuyNowIframe('div.styles_body__kQRBi button');
            if (finalButtonExists) {
              console.log("Clicking final confirmation button in Buy Now iframe");
              await clickInBuyNowIframe('div.styles_body__kQRBi button', 'final-confirm');
            }
            
            console.log("Buy Now checkout completed successfully!");
            utils.updateStatus('Order successfully placed!', 'status-complete');
          }
        } catch (error) {
          console.error("Error in Buy Now checkout:", error);
          // If there's an error, retry the Buy Now flow
          return retryBuyNow(2500); // Increased delay
        }
      }

      /** Add to cart */
      async function addToCart() {
        currentStep = 'add-to-cart';
        utils.updateStatus('Adding item to cart...', 'status-running');
        await setQuantity();
        await utils.sleep(200);
        
        // Check for Buy Now button if that option is enabled
        if (globalSettings.useBuyNowWhenAvailable === true) {
          console.log("Checking for Buy Now button");
          const buyNowButton = document.querySelector('[data-test="buy-now-button"]');
          
          if (buyNowButton && finder.isElementVisible(buyNowButton) && !finder.isElementDisabled(buyNowButton)) {
            console.log("Buy Now button found and enabled, using Buy Now checkout flow");
            return await useBuyNowCheckout(buyNowButton);
          }
          
          // If we reach here, Buy Now button not found or not usable - fall back to regular flow
          console.log("Buy Now button not found or not usable, falling back to Add to cart");
        }
        
        // Regular Add to Cart flow
        let actionButton = finder.findElementWithSelectors(selectors.productPageSelectors.addToCart);
        let buttonType = 'add-to-cart';
        if (!actionButton) { actionButton = finder.findElementWithSelectors([selectors.productPageSelectors.preOrderButton]); if(actionButton) buttonType = 'pre-order'; }
        if (!actionButton) { throw new Error('Add to Cart/Pre-Order button not found.'); }
        if (finder.isElementDisabled(actionButton)) { throw new Error(`"${actionButton.textContent?.trim()}" button disabled.`); }
        const clicked = await utils.clickElement(actionButton, buttonType);
        if (!clicked) { throw new Error(`Failed to click "${actionButton.textContent?.trim()}" button.`); }
      }

      /** Handle popups - optimized for speed */
      async function handlePopups() {
        currentStep = 'handle-popups';
        utils.updateStatus('Checking for popups...', 'status-running');

        // Use a much shorter delay (300ms instead of 1200ms)
        await utils.sleep(300);

        try {
            console.log("Quick popup check...");

            // Check for all popup types at once (no nested if checks)
            const popupButtons = [
                {
                    element: finder.findElementWithSelectors(selectors.popupSelectors.declineProtectionButton),
                    name: 'decline-protection',
                    description: 'protection plan popup'
                },
                {
                    element: finder.findElementWithSelectors(selectors.popupSelectors.noThanksButton),
                    name: 'no-thanks',
                    description: 'no thanks button'
                },
                {
                    element: finder.findElementWithSelectors(selectors.popupSelectors.continueButton),
                    name: 'popup-continue',
                    description: 'continue button',
                    additionalCheck: (el) => !el.closest('form')
                }
            ];

            // Find the first visible popup button
            const popupToHandle = popupButtons.find(popup =>
                popup.element &&
                finder.isElementVisible(popup.element) &&
                (!popup.additionalCheck || popup.additionalCheck(popup.element))
            );

            // Handle the popup if found
            if (popupToHandle) {
                console.log(`Found ${popupToHandle.description}, clicking it`);
                
                // Skip clicking popups during Buy Now error recovery
                if (inBuyNowErrorRecovery) {
                    console.log("In Buy Now error recovery, skipping popup click");
                    return;
                }
                
                await utils.clickElement(popupToHandle.element, popupToHandle.name);

                // Check for additional popups with shorter delay
                await utils.sleep(300);
                return handlePopups(); // Recursive check with much less delay
            } else {
                console.log("No popups detected, proceeding to checkout.");
                return; // Exit immediately
            }
        } catch (error) {
            // Don't throw errors from popup handling - log and continue
            console.warn("Error handling popups, but continuing to checkout:", error);
        }
      }

      /** Go to checkout */
      async function goDirectlyToCheckout() {
        currentStep = 'go-to-checkout';
        
        // Skip navigation if we're in Buy Now error recovery mode
        if (inBuyNowErrorRecovery) {
          console.log("In Buy Now error recovery, skipping navigation to checkout page");
          return;
        }
        
        // Skip navigation if we're in the Buy Now flow (which stays on the same page)
        // Look for the side panel that indicates Buy Now checkout is active
        const buyNowSidePanel = document.querySelector('[data-test="placeOrderButton"]');
        if (buyNowSidePanel) {
          console.log("Buy Now side panel detected, skipping navigation to checkout page");
          return;
        }
        
        utils.updateStatus('Navigating to checkout...', 'status-running');
        console.log("Redirecting to checkout page now");

        // Use direct navigation to checkout for speed and reliability
        window.location.href = 'https://www.target.com/checkout';
      }

      /** Fill shipping info - with smart detection for pre-filled shipping */
      async function fillShippingInfo() {
        currentStep = 'fill-shipping';
        utils.updateStatus('Checking shipping info...', 'status-running');
        if (!profile) throw new Error("Profile missing for shipping.");

        // Look for continue button first - if shipping is already filled by Target account
        const shippingContinueBtn = finder.findElementWithSelectors(selectors.checkoutPageSelectors.continueButtons.shipping);
        if (shippingContinueBtn && finder.isElementVisible(shippingContinueBtn)) {
          console.log("Detected pre-filled shipping information, proceeding...");
          await utils.clickElement(shippingContinueBtn, 'shipping-continue');
          await utils.sleep(500);
          return;
        }

        // If we need to fill shipping info, look for the form
        utils.updateStatus('Filling shipping info...', 'status-running');
        const formContainerSelector = selectors.checkoutPageSelectors.shippingForm.join(', ');
        const shippingFormContainer = await utils.waitForElement(formContainerSelector, 5000);

        // Form not found, check if we're already past shipping
        if (!shippingFormContainer) {
          if (finder.findElementWithSelectors(selectors.checkoutPageSelectors.paymentForm) || document.querySelector(selectors.checkoutPageSelectors.placeOrderButton)) {
            console.log("Skipping shipping, already past shipping step.");
            return;
          } else {
            console.log("Shipping form not found, assuming shipping is handled.");
            return; // Don't throw error, just continue with process
          }
        }
        const fields = selectors.checkoutPageSelectors.shippingFields;
        const p = profile;

        // Fill name, address, etc.
        await finder.fillFieldBySelectors(fields.firstName, p.firstName);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.lastName, p.lastName);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.address1, p.address1);
        await utils.sleep(200);
        if (p.address2) {
          await finder.fillFieldBySelectors(fields.address2, p.address2);
          await utils.sleep(200);
        }
        await finder.fillFieldBySelectors(fields.city, p.city);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.state, p.state);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.zip, p.zip);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.phone, p.phone);
        await utils.sleep(200);
        if (fields.email && finder.findElementWithSelectors(fields.email)) {
          await finder.fillFieldBySelectors(fields.email, p.email);
          await utils.sleep(200);
        }

        // Click continue button
        const continueBtn = finder.findElementWithSelectors(selectors.checkoutPageSelectors.continueButtons.shipping);
        if (continueBtn && finder.isElementVisible(continueBtn)) {
          await utils.clickElement(continueBtn, 'shipping-continue');
          await utils.sleep(500);
        } else {
          console.warn("Shipping continue button not found/visible");
        }
      }

      /** Fill payment info */
      async function fillPaymentInfo() {
        currentStep = 'fill-payment';
        utils.updateStatus('Filling payment info...', 'status-running');
        if (!profile) throw new Error("Profile missing for payment.");
        if (!profile.paymentMethod) {
          console.log("No payment method in profile, skipping.");
          return;
        }

        // Check if we need to add a payment method
        const addPaymentBtn = finder.findElementWithSelectors(selectors.checkoutPageSelectors.addPaymentButton);
        if (addPaymentBtn && finder.isElementVisible(addPaymentBtn)) {
          await utils.clickElement(addPaymentBtn, 'add-payment');
          await utils.sleep(1000);
        }

        const paymentFormSelector = selectors.checkoutPageSelectors.paymentForm.join(', ');
        const paymentForm = await utils.waitForElement(paymentFormSelector, 6000);
        if (!paymentForm) {
          console.log("Payment form not found, may be already filled.");
          return;
        }

        // Check for card iframe
        const cardFrame = document.querySelector(selectors.checkoutPageSelectors.cardNumberFrame.join(', '));
        if (cardFrame) {
          console.log("Detected card input iframe, using special handling");
          // Special iframe handling would go here
          return;
        }

        // Standard form filling
        const fields = selectors.checkoutPageSelectors.paymentFields;
        const p = profile.paymentMethod;

        // Fill card details
        await finder.fillFieldBySelectors(fields.cardNumber, p.cardNumber);
        await utils.sleep(300);
        await finder.fillFieldBySelectors(fields.nameOnCard, p.nameOnCard || `${profile.firstName} ${profile.lastName}`);
        await utils.sleep(300);
        await finder.fillFieldBySelectors(fields.expiryMonth, p.expiryMonth);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.expiryYear, p.expiryYear);
        await utils.sleep(200);
        await finder.fillFieldBySelectors(fields.cvv, p.cvv);
        await utils.sleep(500);
      }

      /** Handle CVV confirmation with robust error handling */
      async function handleCVVConfirmation() {
        // Prevent re-entry if already handling or confirmed
        if (isFillingCvvInput || confirmButtonClicked) return;

        currentStep = 'handle-cvv';
        utils.updateStatus('Confirming CVV...', 'status-running');

        // Set the filling flag to prevent other processes from trying to handle CVV at the same time
        isFillingCvvInput = true;

        try {
          // ALWAYS reload profile data right before using it
          await loadSettingsAndProfile();

          // Get the CVV from the profile, supporting multiple profile structures
          let cvv = null;
          
          // Check all possible places where CVV might be stored
          if (profile?.cvv) {
            console.log("Using CVV from direct profile property");
            cvv = profile.cvv;
          } else if (profile?.paymentMethod?.cvv) {
            console.log("Using CVV from profile.paymentMethod structure");
            cvv = profile.paymentMethod.cvv;
          } else if (profile?.payment?.cvv) {
            console.log("Using CVV from profile.payment structure");
            cvv = profile.payment.cvv;
          }
          
          if (!cvv) {
            console.warn("No CVV found in profile (checked all structures), can't complete CVV verification");
            // Log available profile structure to help debugging
            console.log("Profile data available for CVV verification:", {
              hasDirectCVV: !!profile?.cvv,
              hasPaymentMethod: !!profile?.paymentMethod,
              hasPayment: !!profile?.payment,
              profileKeys: profile ? Object.keys(profile) : []
            });
            return;
          }

          // Find the CVV input
          const cvvInput = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cvvVerification.input);
          if (!cvvInput || !finder.isElementVisible(cvvInput)) {
            console.log("CVV input not visible, skipping.");
            return;
          }

          console.log("Found CVV input field, filling with profile CVV");

          // Fill CVV using the value we found
          await utils.fillField(cvvInput, cvv, 'cvv-verification');
          await utils.sleep(500);

          // Click confirm
          const confirmBtn = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cvvVerification.confirmButton);
          if (confirmBtn && finder.isElementVisible(confirmBtn) && !finder.isElementDisabled(confirmBtn)) {
            if (confirmButtonClicked) {
              console.log("CVV confirm already clicked, skipping.");
              return;
            }

            console.log("Clicking CVV confirm button");
            confirmButtonClicked = true;
            await utils.clickElement(confirmBtn, 'cvv-confirm');
            await utils.sleep(1000);
          } else {
            console.warn("CVV confirm button not found/usable");
          }
        } catch (error) {
          console.error("Error in handleCVVConfirmation:", error);
        } finally {
          // Always reset the filling flag when done
          isFillingCvvInput = false;
        }
      }

      /** Handle credit card confirmation with robust error handling */
      async function handleCreditCardConfirmation() {
        // Prevent re-entry if already handling or verified
        if (isFillingCardInput || verifyCardButtonClicked) return;

        currentStep = 'handle-card-verification';
        utils.updateStatus('Verifying card...', 'status-running');

        // Set flag to prevent duplicate processing
        isFillingCardInput = true;

        try {
          // ALWAYS reload profile data right before using it
          await loadSettingsAndProfile();

          // Check both direct access and nested paymentMethod structure
          let cardNumber = null;
          if (profile) {
            // Try direct structure first (profile.cardNumber)
            if (profile.cardNumber) {
              console.log("Found card number directly in profile");
              cardNumber = profile.cardNumber;
            } 
            // Try nested structure (profile.paymentMethod.cardNumber)
            else if (profile.paymentMethod && profile.paymentMethod.cardNumber) {
              console.log("Found card number in profile.paymentMethod");
              cardNumber = profile.paymentMethod.cardNumber;
            }
          }
          
          if (!cardNumber) {
            console.warn("No card number found in profile (checked both direct and nested structures)");
            utils.updateStatus('Error: Missing card number in profile', 'status-waiting');
            isFillingCardInput = false; // Reset flag on error
            return;
          }

          // Try multiple selector approaches to find the card input field
          let cardInput = document.querySelector('#credit-card-number-input');

          if (!cardInput) {
            console.log("Direct selector didn't find card input, trying alternate methods");
            cardInput = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cardVerification.input);
          }

          // Final fallback - try by type
          if (!cardInput) {
            console.log("Still no card input found, trying type selector");
            cardInput = document.querySelector('input[type="tel"]');
          }

          if (!cardInput || !finder.isElementVisible(cardInput)) {
            console.log("Card input not visible after multiple attempts, skipping verification.");
            return;
          }

          // Use direct access for card number
          console.log("Found card input field, filling with card number:", profile.cardNumber);

          // Focus the input first
          cardInput.focus();
          await utils.sleep(200);

          // Clear any existing value
          cardInput.value = '';
          cardInput.dispatchEvent(new Event('input', { bubbles: true }));
          await utils.sleep(200);

          // Fill card number using direct access
          await utils.fillField(cardInput, profile.cardNumber, 'card-verification');
          console.log("Card number filled:", cardInput.value ? "Yes" : "No");
          await utils.sleep(500);

          // Click verify
          let verifyBtn = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cardVerification.verifyButton);

          // Try direct selector if the array approach failed
          if (!verifyBtn) {
            verifyBtn = document.querySelector('button[data-test="verify-card-button"]');
          }

          // Try text content approach if still not found
          if (!verifyBtn) {
            const allButtons = Array.from(document.querySelectorAll('button'));
            verifyBtn = allButtons.find(btn =>
              (btn.textContent || '').toLowerCase().includes('verify')
            );
          }

          if (verifyBtn && finder.isElementVisible(verifyBtn) && !finder.isElementDisabled(verifyBtn)) {
            if (verifyCardButtonClicked) {
              console.log("Verify card already clicked, skipping.");
              return;
            }

            console.log("Clicking verify card button");
            verifyCardButtonClicked = true;
            await utils.clickElement(verifyBtn, 'verify-card');
            await utils.sleep(1000);
          } else {
            console.warn("Verify card button not found/usable");
          }
        } catch (error) {
          console.error("Error in handleCreditCardConfirmation:", error);
        } finally {
          // Always reset the filling flag when done
          isFillingCardInput = false;
        }
      }

      /**
       * Check for high demand error message
       * @returns {boolean} True if high demand message is found
       */
      function checkForHighDemandMessage() {
        try {
          // Look for the specific high demand error message
          const contentDiv = document.querySelector('.styles_content__WBF0i');
          if (contentDiv) {
            const text = contentDiv.textContent.trim();
            if (text.includes('limiting how many guests can check out due to high demand')) {
              console.log("High demand message detected: " + text);
              return true;
            }
          }
          
          // Alternative: look for any error containing "high demand" or "try again"
          const allErrorMessages = Array.from(document.querySelectorAll('.error, .error-message, [class*="error"], [class*="Error"], [class*="content"]'));
          for (const element of allErrorMessages) {
            const text = element.textContent.trim();
            if (text.includes('high demand') || 
                (text.includes('limiting') && text.includes('try') && text.includes('soon'))) {
              console.log("High demand error message found via fallback: " + text);
              return true;
            }
          }
          
          return false;
        } catch (error) {
          console.warn("Error checking for high demand message:", error);
          return false;
        }
      }
      
      /** Place order with improved post-click handling */
      async function placeOrder() {
        currentStep = 'place-order';
        if (!globalSettings.autoSubmit) {
          utils.updateStatus('Order ready - Submit disabled', 'status-complete');
          console.log("Auto-submit disabled, stopping at final review.");
          return;
        }

        utils.updateStatus('Placing order...', 'status-running');
        
        // Check for high demand message first
        if (checkForHighDemandMessage()) {
          console.log("High demand message detected, will auto-retry every 3 seconds");
          utils.updateStatus('High demand message detected - auto-retrying...', 'status-running');
          
          // Set up retry interval but ensure we don't create duplicates
          if (!window.highDemandRetryInterval) {
            window.highDemandRetryInterval = setInterval(() => {
              try {
                console.log("Auto-retrying place order due to high demand...");
                
                // Find the place order button
                const placeOrderBtn = document.querySelector(selectors.checkoutPageSelectors.placeOrderButton);
                if (placeOrderBtn && finder.isElementVisible(placeOrderBtn)) {
                  // Temporarily reset the flag so we can click again
                  placeOrderButtonClicked = false;
                  
                  // Click the button
                  utils.clickElement(placeOrderBtn, 'high-demand-retry');
                  
                  // Set the flag back
                  placeOrderButtonClicked = true;
                }
                
                // If message is gone, clear the interval
                if (!checkForHighDemandMessage()) {
                  console.log("High demand message no longer detected, clearing retry interval");
                  clearInterval(window.highDemandRetryInterval);
                  window.highDemandRetryInterval = null;
                }
              } catch (e) {
                console.error("Error in high demand retry interval:", e);
              }
            }, 3000); // Retry every 3 seconds
            
            // Add the interval to our tracked intervals
            intervals.push(window.highDemandRetryInterval);
          }
        }

        // First check for CVV confirmation which might appear before placing order
        const cvvInput = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cvvVerification.input);
        if (cvvInput) {
          console.log("CVV confirmation required before placing order");
          // Reset the click flag so we can later retry placing the order
          placeOrderButtonClicked = false;
          await handleCVVConfirmation();
          return;
        }

        // Check for credit card confirmation
        const cardInput = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cardVerification.input);
        if (cardInput) {
          console.log("Card verification required before placing order");
          // Reset the click flag so we can later retry placing the order
          placeOrderButtonClicked = false;
          await handleCreditCardConfirmation();
          return;
        }

        // Check for and accept terms if needed
        const termsCheckbox = finder.findElementWithSelectors(selectors.checkoutPageSelectors.termsCheckbox);
        if (termsCheckbox && finder.isElementVisible(termsCheckbox) && !termsCheckbox.checked) {
          termsCheckbox.checked = true;
          termsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          await utils.sleep(500);
        }

        // Find and click place order button
        const placeOrderBtn = document.querySelector(selectors.checkoutPageSelectors.placeOrderButton);
        if (!placeOrderBtn) {
          console.warn("Place order button not found");
          return;
        }

        if (!finder.isElementVisible(placeOrderBtn)) {
          console.warn("Place order button not visible");
          return;
        }

        if (finder.isElementDisabled(placeOrderBtn)) {
          console.warn("Place order button is disabled");
          
          // Check for "Save and continue" button when place order is disabled
          const saveAndContinueBtn = finder.findElementWithSelectors(selectors.checkoutPageSelectors.continueButtons.saveAndContinue);
          if (saveAndContinueBtn && finder.isElementVisible(saveAndContinueBtn) && !finder.isElementDisabled(saveAndContinueBtn)) {
            console.log("Found 'Save and continue' button when place order button is disabled");
            utils.updateStatus('Continuing checkout steps...', 'status-running');
            await utils.clickElement(saveAndContinueBtn, 'save-and-continue');
            await utils.sleep(1500);
            
            // Reset place order button clicked flag to allow re-attempting to place order after advancing
            placeOrderButtonClicked = false;
            return;
          }
          
          return;
        }

        if (placeOrderButtonClicked) {
          console.log("Place order already clicked, avoiding duplicate click.");
          return;
        }

        // Critical click - actually submits the order
        placeOrderButtonClicked = true;
        utils.updateStatus('Submitting order...', 'status-running');
        await utils.clickElement(placeOrderBtn, 'place-order');

        // Wait for potential CVV or card verification forms that may appear after clicking
        await utils.sleep(2000);

        // Check for CVV form after clicking place order
        const postClickCvv = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cvvVerification.input);
        if (postClickCvv) {
          console.log("CVV verification required after placing order");
          // Reset click flag so we can place order again after CVV
          confirmButtonClicked = false;
          placeOrderButtonClicked = false;
          await handleCVVConfirmation();
          // After handling CVV, try placing order again
          await utils.sleep(1000);
          await placeOrder();
          return;
        }

        // Check for card verification form after clicking place order
        const postClickCard = finder.findElementWithSelectors(selectors.checkoutPageSelectors.cardVerification.input);
        if (postClickCard) {
          console.log("Card verification required after placing order");
          // Reset click flag so we can place order again after card verification
          verifyCardButtonClicked = false;
          placeOrderButtonClicked = false;
          await handleCreditCardConfirmation();
          // After handling card verification, try placing order again
          await utils.sleep(1000);
          await placeOrder();
          return;
        }

        // If we got here with no further forms, order was likely placed successfully
        utils.updateStatus('Order successfully placed!', 'status-complete');
      }

      /**
       * Set up checkout page observers - Refined logic based on working implementation
       */
      function setupCheckoutPageObservers() {
        console.log("Setting up checkout page observers (Refined)");

        // --- Cleanup existing ---
        observers.forEach(observer => {
          if (observer && observer.disconnect) observer.disconnect();
        });
        observers = [];
        intervals.forEach(interval => clearInterval(interval));
        intervals = [];

        // --- Reset state ---
        // Crucially reset flags *before* setting up new watchers
        placeOrderButtonClicked = false;
        confirmButtonClicked = false;
        verifyCardButtonClicked = false;
        isFillingCardInput = false;
        isFillingCvvInput = false;

        // --- Single MutationObserver ---
        const checkoutObserver = new MutationObserver((mutations) => {
          // Skip if disabled or filling inputs
          if (!isEnabled || isFillingCvvInput || isFillingCardInput) return;

          // Check for elements in priority order, handle only the first one found per mutation batch

          // 1. CVV Input
          const cvvInput = document.querySelector('#enter-cvv');
          if (cvvInput && cvvInput.offsetParent !== null && !confirmButtonClicked) {
            console.log("Observer: CVV input detected");
            handleCVVConfirmation().catch(e => console.error("Observer CVV error:", e));
            return; // Handle only this
          }

          // 2. Card Verification Input
          const cardInput = document.querySelector('#credit-card-number-input');
          if (cardInput && cardInput.offsetParent !== null && !verifyCardButtonClicked) {
            console.log("Observer: Card verification input detected");
            handleCreditCardConfirmation().catch(e => console.error("Observer Card Verify error:", e));
            return; // Handle only this
          }

          // 3. Place Order Button (only if no verification needed and not already clicked)
          const placeOrderBtn = document.querySelector('button[data-test="placeOrderButton"]');
          if (placeOrderBtn && placeOrderBtn.offsetParent !== null && !placeOrderBtn.disabled && !placeOrderButtonClicked) {
            console.log("Observer: Place order button detected");
            placeOrder().catch(e => console.error("Observer Place Order error:", e));
            // No return here, as placeOrder might lead to CVV/Card verification
          }
        });

        // Observe the entire body for changes
        checkoutObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true // Watch attributes too (like disabled state)
        });
        observers.push(checkoutObserver);

        // --- Safety Interval (Less Frequent) ---
        const intervalId = setInterval(() => {
          // Skip if disabled or filling inputs
          if (!isEnabled || isFillingCvvInput || isFillingCardInput) return;

          try {
            // Check elements in priority, respecting flags

            // 1. CVV Input
            const cvvInput = document.querySelector('#enter-cvv');
            if (cvvInput && cvvInput.offsetParent !== null && !confirmButtonClicked) {
              console.log("Interval: CVV input detected");
              handleCVVConfirmation().catch(e => console.error("Interval CVV error:", e));
              return; // Handle only this
            }

            // 2. Card Verification Input
            const cardInput = document.querySelector('#credit-card-number-input');
            if (cardInput && cardInput.offsetParent !== null && !verifyCardButtonClicked) {
              console.log("Interval: Card verification input detected");
              handleCreditCardConfirmation().catch(e => console.error("Interval Card Verify error:", e));
              return; // Handle only this
            }

            // 3. Place Order Button
            const placeOrderBtn = document.querySelector('button[data-test="placeOrderButton"]');
            if (placeOrderBtn && placeOrderBtn.offsetParent !== null && !placeOrderBtn.disabled && !placeOrderButtonClicked) {
              console.log("Interval: Place order button detected");
              placeOrder().catch(e => console.error("Interval Place Order error:", e));
            }
          } catch (error) {
            console.warn("Error in checkout interval check:", error);
          }
        }, 5000); // Check less frequently (e.g., every 5 seconds)

        intervals.push(intervalId);

        console.log("Checkout page observers and safety interval set up");
      }
    }
  }
}
