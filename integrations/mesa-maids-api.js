// Integration with Mesa Maids website to fetch live data
// This allows the AI to access real FAQ, checklist, booking info, etc.

import axios from 'axios';

const MESA_MAIDS_API = process.env.MESA_MAIDS_URL || 'https://mesamaids.com';

// Fetch live FAQ from Mesa Maids site
export async function fetchLiveFAQ() {
  try {
    // If you have an API endpoint that returns FAQ data
    const response = await axios.get(`${MESA_MAIDS_API}/api/faq`);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch live FAQ:', error.message);
    return null;
  }
}

// Fetch current pricing/quote logic
export async function getQuoteFromAPI(bedrooms, bathrooms, serviceType, addons = []) {
  try {
    // Call your actual quote API endpoint
    const response = await axios.post(`${MESA_MAIDS_API}/api/submit-quote`, {
      bedrooms,
      bathrooms,
      serviceType,
      addons,
      // Add any other required fields
    });
    
    return {
      success: true,
      quote: response.data
    };
  } catch (error) {
    console.error('Failed to get quote from API:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Fetch checklist for specific service type
export async function getServiceChecklist(serviceType) {
  try {
    const response = await axios.get(`${MESA_MAIDS_API}/api/checklist/${serviceType}`);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch checklist:', error.message);
    return null;
  }
}

// Check real-time availability
export async function checkAvailability(date) {
  try {
    const response = await axios.post(`${MESA_MAIDS_API}/api/check-availability`, {
      date
    });
    return response.data;
  } catch (error) {
    console.error('Failed to check availability:', error.message);
    return null;
  }
}

// Lookup customer by phone number (from your CRM/database)
export async function lookupCustomer(phone) {
  try {
    // This would query your database or HubSpot
    // For now, return null - you'd implement this based on your setup
    
    // Example if you had an API:
    // const response = await axios.get(`${MESA_MAIDS_API}/api/customer/${phone}`);
    // return response.data;
    
    return null;
  } catch (error) {
    console.error('Failed to lookup customer:', error.message);
    return null;
  }
}

// Extract property details from customer message
export function parsePropertyDetails(message, conversationHistory = []) {
  // Extract bedrooms
  const bedroomMatch = message.match(/(\d+)\s*(?:bed|bedroom|br|bd)/i);
  let bedrooms = bedroomMatch ? bedroomMatch[1] : null;
  
  // Check previous messages if not found
  if (!bedrooms && conversationHistory.length > 0) {
    const prevMessages = conversationHistory.map(m => m.body || m.content || '').join(' ');
    const prevBedroomMatch = prevMessages.match(/(\d+)\s*(?:bed|bedroom|br|bd)/i);
    bedrooms = prevBedroomMatch ? prevBedroomMatch[1] : null;
  }
  
  // Extract bathrooms
  const bathroomMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba)/i);
  let bathrooms = bathroomMatch ? bathroomMatch[1] : null;
  
  if (!bathrooms && conversationHistory.length > 0) {
    const prevMessages = conversationHistory.map(m => m.body || m.content || '').join(' ');
    const prevBathroomMatch = prevMessages.match(/(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba)/i);
    bathrooms = prevBathroomMatch ? prevBathroomMatch[1] : null;
  }
  
  // Extract service type
  let serviceType = 'Standard Clean';
  const messageLower = message.toLowerCase();
  
  if (messageLower.includes('deep')) serviceType = 'Deep Clean';
  else if (messageLower.includes('super')) serviceType = 'Super Clean';
  else if (messageLower.includes('move')) serviceType = 'Move In/Out';
  else if (messageLower.includes('standard')) serviceType = 'Standard Clean';
  else {
    // Check conversation history
    const prevMessages = conversationHistory.map(m => m.body || m.content || '').join(' ').toLowerCase();
    if (prevMessages.includes('deep')) serviceType = 'Deep Clean';
    else if (prevMessages.includes('super')) serviceType = 'Super Clean';
    else if (prevMessages.includes('move')) serviceType = 'Move In/Out';
  }
  
  // Extract add-ons
  const addons = [];
  if (messageLower.includes('fridge') || messageLower.includes('refrigerator')) {
    addons.push('insideFridge');
  }
  if (messageLower.includes('oven')) {
    addons.push('insideOven');
  }
  if (messageLower.includes('window')) {
    addons.push('interiorWindows');
  }
  if (messageLower.includes('laundry')) {
    addons.push('laundry');
  }
  if (messageLower.includes('dishes')) {
    addons.push('dishes');
  }
  
  // Check if they want to remove add-ons
  const removeAddons = messageLower.includes('remove') || messageLower.includes('without');
  
  return {
    bedrooms,
    bathrooms,
    serviceType,
    addons: removeAddons ? [] : addons,
    hasPropertyDetails: bedrooms && bathrooms
  };
}

