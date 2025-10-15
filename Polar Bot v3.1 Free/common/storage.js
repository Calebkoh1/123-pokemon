// common/storage.js - Storage management utilities (Attaches to window.autocheckoutStorage)

/**
 * Get value(s) from storage
 * @param {string|string[]|null} keys - Key, array of keys, or null to retrieve all
 * @returns {Promise<Object>} - Promise resolving to object with keys
 */
function getFromStorage(keys) {
  return new Promise((resolve, reject) => {
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, (result) => {
         if (chrome.runtime.lastError) {
            console.error("Storage get error:", chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
         } else {
            resolve(result);
         }
        });
    } else {
        console.error("chrome.storage.local not available in this context.");
        reject(new Error("Storage API not available"));
    }
  });
}

/**
 * Save value(s) to storage
 * @param {Object} data - Object with key/value pairs to save
 * @returns {Promise<void>} - Promise resolving when data is saved
 */
function saveToStorage(data) {
  return new Promise((resolve, reject) => {
     if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(data, () => {
         if (chrome.runtime.lastError) {
            console.error("Storage set error:", chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
         } else {
            resolve();
         }
        });
    } else {
        console.error("chrome.storage.local not available in this context.");
        reject(new Error("Storage API not available"));
    }
  });
}

/**
 * Get site-specific settings
 * @param {string} site - Site name (e.g. 'target')
 * @returns {Promise<Object>} - Promise resolving to site settings and global settings
 */
async function getSiteSettings(site) {
  const data = await getFromStorage(['siteSettings', 'globalSettings']);
  const siteSettings = data.siteSettings && data.siteSettings[site] ?
    data.siteSettings[site] : {};

  return {
    siteSettings,
    globalSettings: data.globalSettings || {}
  };
}

/**
 * Update site-specific settings
 * @param {string} site - Site name (e.g. 'target')
 * @param {Object} settings - New settings for the site
 * @returns {Promise<void>} - Promise resolving when settings are saved
 */
async function updateSiteSettings(site, settings) {
  // Ensure partial updates work correctly by getting existing settings first
  const data = await getFromStorage('siteSettings');
  const allSiteSettings = data.siteSettings || {}; // Use a different variable name

  // Merge existing site settings with new settings
  allSiteSettings[site] = {
    ...(allSiteSettings[site] || {}), // Start with existing or empty object
    ...settings
  };

  return saveToStorage({ siteSettings: allSiteSettings }); // Save the entire siteSettings object back
}


/**
 * Get all profiles and the selected profile ID/object
 * @returns {Promise<{profiles: Array, selectedProfile: Object|null, selectedProfileId: string|null}>}
 */
async function getProfiles() {
  try {
    console.log("storage.js: Beginning profile data retrieval");
    const data = await getFromStorage(['profiles', 'selectedProfile']);
    
    // Log what we retrieved
    console.log("storage.js: Raw storage data retrieved:", 
                data ? "Data present" : "No data", 
                "profiles array:", Array.isArray(data.profiles) ? `length ${data.profiles?.length}` : "not an array",
                "selectedProfile:", data.selectedProfile ? `ID ${data.selectedProfile}` : "none");
    
    const profiles = data.profiles || [];
    const selectedProfileId = data.selectedProfile || null; // Ensure it's null if not set

    let selectedProfile = null;
    let profileWasFixed = false;
    
    // First check if there are any profiles
    if (profiles.length === 0) {
      console.warn("storage.js: No profiles found in storage, this will result in placeholder data being used");
      return { profiles, selectedProfile: null, selectedProfileId: null };
    }
    
    // Check if we have a selected profile ID and try to find it in profiles
    if (selectedProfileId && profiles.length > 0) {
      selectedProfile = profiles.find(p => p.id === selectedProfileId);
      
      // We'll validate payment info after checking all possible locations
      if (selectedProfile) {
        console.log("storage.js: Selected profile found, will validate payment details later");
      }
      
      // Fallback if ID is invalid but profiles exist
      if (!selectedProfile && profiles.length > 0) {
        console.warn(`storage.js: Selected profile ID ${selectedProfileId} not found, using first profile as fallback.`);
        selectedProfile = profiles[0];
        // Actually update storage to fix the selected ID (this was previously commented out)
        await saveToStorage({ selectedProfile: profiles[0].id });
        console.log(`storage.js: Updated selected profile ID to ${profiles[0].id}`);
        profileWasFixed = true;
      }
    } else if (!selectedProfileId && profiles.length > 0) {
      // Default to first profile if none selected
      console.log("storage.js: No profile selected, defaulting to the first profile.");
      selectedProfile = profiles[0];
      // Actually save this default selection back to storage (this was previously commented out)
      await saveToStorage({ selectedProfile: profiles[0].id });
      console.log(`storage.js: Set selected profile ID to first profile: ${profiles[0].id}`);
      profileWasFixed = true;
    }

    // Final validation check - support all possible payment data structures
    if (selectedProfile) {
      // Check all possible payment data locations
      const hasPaymentMethod = selectedProfile.paymentMethod && selectedProfile.paymentMethod.cardNumber;
      const hasPayment = selectedProfile.payment && selectedProfile.payment.cardNumber;
      const hasDirectCard = selectedProfile.cardNumber;
      
      // Only show warning if no payment data found in any location
      if (!hasPaymentMethod && !hasPayment && !hasDirectCard) {
        console.warn("storage.js: Selected profile exists but has no payment details");
      } else {
        // Payment data exists in at least one location
        // Determine which structure to use for logging
        if (hasPaymentMethod) {
          const maskedCard = selectedProfile.paymentMethod.cardNumber.substring(0, 4) + "..." + 
                            selectedProfile.paymentMethod.cardNumber.substring(selectedProfile.paymentMethod.cardNumber.length - 4);
          console.log(`storage.js: Successfully retrieved selected profile with card ${maskedCard} (paymentMethod structure)`);
        } else if (hasPayment) {
          const maskedCard = selectedProfile.payment.cardNumber.substring(0, 4) + "..." + 
                            selectedProfile.payment.cardNumber.substring(selectedProfile.payment.cardNumber.length - 4);
          console.log(`storage.js: Successfully retrieved selected profile with card ${maskedCard} (payment structure)`);
        } else if (hasDirectCard) {
          const maskedCard = selectedProfile.cardNumber.substring(0, 4) + "..." + 
                            selectedProfile.cardNumber.substring(selectedProfile.cardNumber.length - 4);
          console.log(`storage.js: Successfully retrieved selected profile with card ${maskedCard} (direct structure)`);
        }
      }
    }

    // Detailed profile validation before returning
    if (selectedProfile) {
      const cardData = {};
      
      // Check all possible payment data structures
      if (selectedProfile.payment && selectedProfile.payment.cardNumber) {
        cardData.structure = "payment";
        cardData.cardNumber = selectedProfile.payment.cardNumber;
        cardData.cvv = selectedProfile.payment.cvv;
      } else if (selectedProfile.paymentMethod && selectedProfile.paymentMethod.cardNumber) {
        cardData.structure = "paymentMethod";
        cardData.cardNumber = selectedProfile.paymentMethod.cardNumber;
        cardData.cvv = selectedProfile.paymentMethod.cvv;
      } else if (selectedProfile.cardNumber) {
        cardData.structure = "direct";
        cardData.cardNumber = selectedProfile.cardNumber;
        cardData.cvv = selectedProfile.cvv;
      }
      
      // If payment data found, add it to the profile in a standardized location
      if (cardData.cardNumber) {
        console.log(`storage.js: Found valid payment data in '${cardData.structure}' structure`);
        
        // Ensure the profile has a standardized payment structure regardless of original format
        if (!selectedProfile.payment) {
          selectedProfile.payment = {};
        }
        if (!selectedProfile.paymentMethod) {
          selectedProfile.paymentMethod = {};
        }
        
        // Duplicate data to all locations to ensure compatibility with all code paths
        selectedProfile.cardNumber = cardData.cardNumber;
        selectedProfile.cvv = cardData.cvv;
        selectedProfile.payment.cardNumber = cardData.cardNumber;
        selectedProfile.payment.cvv = cardData.cvv;
        selectedProfile.paymentMethod.cardNumber = cardData.cardNumber;
        selectedProfile.paymentMethod.cvv = cardData.cvv;
      } else {
        console.warn("storage.js: No valid payment data found in any profile structure location");
      }
    }
    
    return {
      profiles,
      selectedProfile, // The actual profile object (or null)
      selectedProfileId: profileWasFixed ? profiles[0].id : selectedProfileId, // Return updated ID if we fixed it
      profileWasFixed, // Flag to indicate we made changes
      paymentDataFound: selectedProfile && (
        (selectedProfile.payment && selectedProfile.payment.cardNumber) ||
        (selectedProfile.paymentMethod && selectedProfile.paymentMethod.cardNumber) ||
        selectedProfile.cardNumber
      )
    };
  } catch (error) {
    console.error("storage.js: Error retrieving profiles:", error);
    // Return empty data in case of error to avoid crashes
    return {
      profiles: [],
      selectedProfile: null,
      selectedProfileId: null,
      error: error.message
    };
  }
}

/**
 * Create or update a profile
 * @param {Object} profile - Profile to save
 * @param {boolean} isNew - Whether this is a new profile
 * @returns {Promise<string>} - Promise resolving to profile ID
 */
async function saveProfile(profile, isNew = false) {
  const data = await getFromStorage('profiles');
  let profiles = data.profiles || [];

  // Generate ID for new profiles or if ID is missing
  if (isNew || !profile.id) {
    profile.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // Update existing or add new
  const index = profiles.findIndex(p => p.id === profile.id);
  if (index !== -1) {
    profiles[index] = profile;
  } else {
    profiles.push(profile);
  }

  await saveToStorage({ profiles });

  // If this is the first profile saved, or if no profile is currently selected,
  // set this one as selected.
  const currentSelection = await getFromStorage('selectedProfile');
  if (profiles.length === 1 || !currentSelection.selectedProfile) {
    await saveToStorage({ selectedProfile: profile.id });
  }

  return profile.id;
}

/**
 * Delete a profile
 * @param {string} profileId - ID of profile to delete
 * @returns {Promise<void>} - Promise resolving when profile is deleted
 */
async function deleteProfile(profileId) {
  const data = await getFromStorage(['profiles', 'selectedProfile']);
  let profiles = data.profiles || [];
  const selectedProfileId = data.selectedProfile;

  // Filter out the profile to delete
  const initialLength = profiles.length;
  profiles = profiles.filter(p => p.id !== profileId);

  // Check if a profile was actually deleted
  if (profiles.length === initialLength) {
      console.warn(`Profile with ID ${profileId} not found for deletion.`);
      return; // Nothing to do
  }


  // Prepare data to update storage
  const updateData = { profiles };

  // If the deleted profile was the selected one, select a new one
  if (selectedProfileId === profileId) {
    if (profiles.length > 0) {
      updateData.selectedProfile = profiles[0].id; // Select the first remaining
    } else {
      updateData.selectedProfile = ''; // No profiles left, clear selection
    }
  }

  return saveToStorage(updateData);
}

// Attach all functions to the window object
window.autocheckoutStorage = {
  getFromStorage,
  saveToStorage,
  getSiteSettings,
  updateSiteSettings,
  getProfiles,
  saveProfile,
  deleteProfile
};

// No longer need to attach to window or dispatch event when using executeScript
console.log("common/storage.js: Script loaded.");
