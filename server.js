import express from 'express';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import { buildSystemPrompt } from './config/prompt-builder.js';
import { parsePropertyDetails } from './integrations/mesa-maids-api.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================

const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_API = 'https://api.openphone.com/v1';
const OPENPHONE_USER_ID = process.env.OPENPHONE_USER_ID || 'US4XHj7ZrY';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Brooklyn Maids';
const BUSINESS_DOMAIN = process.env.BUSINESS_DOMAIN || 'brooklynmaids.com';
const AGENT_NAME = process.env.AGENT_NAME || 'Ellie';
const TEST_PHONE = process.env.TEST_PHONE_NUMBER;

const MAX_RESPONSES_PER_HOUR = parseInt(process.env.MAX_RESPONSES_PER_HOUR) || 10;
const ENABLE_AUTO_RESPONSE = process.env.ENABLE_AUTO_RESPONSE === 'true';
const BUSINESS_HOURS_START = parseInt(process.env.BUSINESS_HOURS_START) || 8;
const BUSINESS_HOURS_END = parseInt(process.env.BUSINESS_HOURS_END) || 18;

// Validate API keys
if (!OPENPHONE_API_KEY) {
  console.error('OpenPhone API key is not set!');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error('Anthropic API key is not set!');
  process.exit(1);
}

// Initialize Claude
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// Rate limiting storage (in production, use Redis or database)
const responseTracker = new Map();

// ============================================
// SYSTEM PROMPT FOR CLAUDE
// ============================================

const SYSTEM_PROMPT = buildSystemPrompt();

// ============================================
// HELPER FUNCTIONS
// ============================================

// Format phone number
function formatPhoneNumber(phone) {
  const phoneNumber = phone.replace(/\D/g, '');
  if (phoneNumber.length === 10) {
    return `+1${phoneNumber}`;
  } else if (phoneNumber.length > 10) {
    return `+${phoneNumber}`;
  }
  return null;
}

// Check if within business hours
function isBusinessHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  
  // Sunday = 0, Saturday = 6
  if (day === 0) return false;
  
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

// Check rate limit
function checkRateLimit(phoneNumber) {
  const now = Date.now();
  const hourAgo = now - (60 * 60 * 1000);
  
  if (!responseTracker.has(phoneNumber)) {
    responseTracker.set(phoneNumber, []);
  }
  
  const timestamps = responseTracker.get(phoneNumber);
  const recentResponses = timestamps.filter(t => t > hourAgo);
  
  responseTracker.set(phoneNumber, recentResponses);
  
  return recentResponses.length < MAX_RESPONSES_PER_HOUR;
}

function recordResponse(phoneNumber) {
  const timestamps = responseTracker.get(phoneNumber) || [];
  timestamps.push(Date.now());
  responseTracker.set(phoneNumber, timestamps);
}

// Send SMS via OpenPhone
async function sendSMS(toNumber, message, fromNumber = TEST_PHONE) {
  try {
    const response = await axios({
      method: 'post',
      url: `${OPENPHONE_API}/messages`,
      headers: {
        'Authorization': OPENPHONE_API_KEY,
        'Content-Type': 'application/json'
      },
      data: {
        content: message,
        from: fromNumber,
        to: [toNumber],
        userId: OPENPHONE_USER_ID,
        setInboxStatus: 'done'
      }
    });

    if (response.status === 202) {
      console.log(`✅ SMS sent successfully to ${toNumber}`);
      return { success: true };
    }
    return { success: false, error: 'Unexpected status code' };
  } catch (error) {
    console.error('❌ SMS sending failed:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

// Get conversation history from OpenPhone
async function getConversationHistory(conversationId) {
  try {
    // OpenPhone v3 API uses different endpoint structure
    const response = await axios({
      method: 'get',
      url: `${OPENPHONE_API}/conversations/${conversationId}/messages`,
      headers: {
        'Authorization': OPENPHONE_API_KEY,
        'Content-Type': 'application/json'
      },
      params: {
        maxResults: 20
      }
    });
    
    if (response.data && response.data.data) {
      // Filter out our own messages, keep only customer messages and our responses
      const messages = response.data.data
        .filter(msg => msg.direction === 'incoming' || msg.direction === 'outgoing')
        .reverse(); // Oldest first
      
      console.log(`📋 Retrieved ${messages.length} messages from conversation history`);
      return messages;
    }
    return [];
  } catch (error) {
    console.error('Failed to fetch conversation history:', error.response?.data || error.message);
    console.error('Conversation ID:', conversationId);
    // Return empty array so bot can still respond (just without context)
    return [];
  }
}

// Build conversation context for Claude
function buildConversationContext(messages) {
  if (!messages || messages.length === 0) return '';
  
  const context = messages.map(msg => {
    const role = msg.direction === 'incoming' ? 'Customer' : 'You (Sarah)';
    const content = msg.body || msg.content || '';
    return `${role}: ${content}`;
  }).join('\n');
  
  return context;
}

// Check if quote/link was already sent in conversation
function wasQuoteSent(messages) {
  if (!messages || messages.length === 0) return false;
  
  const ourMessages = messages.filter(m => m.direction === 'outgoing');
  
  for (const msg of ourMessages) {
    const content = (msg.body || msg.content || '').toLowerCase();
    // Check if message contains pricing ($XXX) or booking link
    if (content.includes('mesamaids.com') || content.match(/\$\d+/)) {
      return true;
    }
  }
  
  return false;
}

// Decision logic: Should we auto-respond?
async function shouldAutoRespond(message, conversationHistory) {
  const messageContent = (message.body || message.content || '').toLowerCase();
  
  // Keywords that should flag for human
  const escalationKeywords = [
    'complaint', 'complain', 'terrible', 'awful', 'horrible', 'worst',
    'sue', 'lawsuit', 'lawyer', 'attorney',
    'refund', 'money back', 'charge',
    'cancel my booking', 'reschedule my booking',
    'angry', 'upset', 'disappointed', 'unsatisfied',
    'damaged', 'broke', 'broken', 'stole', 'stolen', 'missing'
  ];
  
  // Check for escalation keywords
  for (const keyword of escalationKeywords) {
    if (messageContent.includes(keyword)) {
      console.log(`🚨 Escalation keyword detected: "${keyword}"`);
      return { shouldRespond: false, reason: `Contains escalation keyword: ${keyword}` };
    }
  }
  
  // Check if too many messages in this conversation
  const incomingCount = conversationHistory.filter(m => m.direction === 'incoming').length;
  if (incomingCount > 5) {
    console.log('🚨 Too many messages in conversation');
    return { shouldRespond: false, reason: 'Too many messages (>5)' };
  }
  
  // Check rate limit
  if (!checkRateLimit(message.from)) {
    console.log('🚨 Rate limit exceeded');
    return { shouldRespond: false, reason: 'Rate limit exceeded' };
  }
  
  // Check business hours (optional - you can disable this)
  if (!isBusinessHours() && process.env.NODE_ENV === 'production') {
    console.log('🚨 Outside business hours');
    return { shouldRespond: false, reason: 'Outside business hours' };
  }
  
  // All checks passed
  return { shouldRespond: true, reason: 'All checks passed' };
}

// Generate AI response using Claude
async function generateAIResponse(message, conversationHistory) {
  try {
    const messageContent = message.body || message.content;
    
    // Parse property details from current message and history
    const propertyDetails = parsePropertyDetails(messageContent, conversationHistory);
    
    // Build context from conversation history
    let conversationContext = '';
    if (conversationHistory.length > 0) {
      conversationContext = buildConversationContext(conversationHistory);
    }
    
    // Check if quote/link was already sent
    const quoteSent = wasQuoteSent(conversationHistory);
    
    console.log('🔍 Context extraction:', {
      bedrooms: propertyDetails.bedrooms,
      bathrooms: propertyDetails.bathrooms,
      serviceType: propertyDetails.serviceType,
      quoteSent,
      historyLength: conversationHistory.length
    });
    
    // Build enhanced prompt with extracted context
    let promptContext = '';
    
    if (conversationContext && conversationHistory.length > 0) {
      promptContext = `PREVIOUS MESSAGES IN THIS CONVERSATION:
${conversationContext}

IMPORTANT CONTEXT YOU MUST REMEMBER:
The customer asked about a ${propertyDetails.bedrooms} bedroom, ${propertyDetails.bathrooms} bathroom ${propertyDetails.serviceType}.
${quoteSent ? 'You already gave them a price and booking link.' : 'This is their first pricing question.'}

THEIR NEW QUESTION:
${messageContent}

RULES:
1. They're asking about the SAME property (${propertyDetails.bedrooms}bd/${propertyDetails.bathrooms}ba) unless they specify different
2. ${quoteSent ? 'DON\'T send the booking link again - you already sent it' : 'Include the booking link'}
3. Calculate the price based on what they originally asked about
4. Keep it short and friendly

Answer their question:`;
    } else {
      promptContext = `Customer: ${messageContent}

Answer helpfully. If giving a price, include the booking link.`;
    }
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150, // Keep short to force brevity
      temperature: 0.5, // Lower for consistency
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: promptContext
        }
      ]
    });
    
    const aiMessage = response.content[0].text;
    
    // Log confidence (based on response structure)
    console.log(`🤖 AI Response generated (${response.usage.input_tokens} input tokens, ${response.usage.output_tokens} output tokens)`);
    
    return {
      success: true,
      message: aiMessage,
      usage: response.usage
    };
    
  } catch (error) {
    console.error('❌ Claude API error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Validate AI response (sanity checks)
function validateAIResponse(response) {
  // Too short
  if (response.length < 10) {
    return { valid: false, reason: 'Response too short' };
  }
  
  // Too long (SMS limit is 1600 chars but we should keep shorter)
  if (response.length > 800) {
    return { valid: false, reason: 'Response too long for SMS' };
  }
  
  // Contains placeholder text
  const placeholders = ['[INSERT', '[FILL IN', 'XXX', 'TODO', 'PLACEHOLDER'];
  for (const placeholder of placeholders) {
    if (response.includes(placeholder)) {
      return { valid: false, reason: 'Contains placeholder text' };
    }
  }
  
  return { valid: true };
}

// ============================================
// MAIN WEBHOOK HANDLER - INCOMING MESSAGES
// ============================================

app.post('/webhook/incoming-message', async (req, res) => {
  try {
    console.log('\n=== 📩 Incoming Message Webhook ===');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { object, type, data } = req.body;
    
    // OpenPhone v3 API sends events with nested structure
    // Handle both old and new formats
    let messageData;
    
    if (object === 'event' && type === 'message.received' && data?.object) {
      // OpenPhone v3 API format
      messageData = data.object;
    } else if (object === 'message' && data) {
      // Legacy format
      messageData = data;
    } else {
      console.log('❌ Not a message event');
      return res.sendStatus(200);
    }
    
    // Only process incoming messages (not our outgoing ones)
    if (messageData.direction !== 'incoming') {
      console.log('⏩ Skipping outgoing message');
      return res.sendStatus(200);
    }
    
    const customerPhone = messageData.from;
    const messageContent = messageData.body || messageData.content;
    const conversationId = messageData.conversationId;
    
    console.log(`📱 From: ${customerPhone}`);
    console.log(`💬 Message: ${messageContent}`);
    console.log(`🔗 Conversation ID: ${conversationId}`);
    
    // Check if auto-response is enabled
    if (!ENABLE_AUTO_RESPONSE) {
      console.log('⚠️  Auto-response disabled, skipping');
      return res.sendStatus(200);
    }
    
    // Get conversation history
    console.log('📜 Fetching conversation history...');
    const conversationHistory = await getConversationHistory(conversationId);
    console.log(`📚 Found ${conversationHistory.length} previous messages`);
    
    if (conversationHistory.length > 0) {
      console.log('📝 Recent messages:', conversationHistory.slice(-3).map(m => ({
        direction: m.direction,
        content: (m.body || m.content || '').substring(0, 50)
      })));
    }
    
    // Decide if we should auto-respond
    const decision = await shouldAutoRespond(messageData, conversationHistory);
    console.log(`🤔 Decision: ${decision.shouldRespond ? '✅ Auto-respond' : '❌ Flag for human'}`);
    console.log(`📝 Reason: ${decision.reason}`);
    
    if (!decision.shouldRespond) {
      // Flag for human - don't mark as done, leave in inbox
      console.log('👤 Leaving in inbox for human response');
      return res.sendStatus(200);
    }
    
    // Generate AI response
    console.log('🤖 Generating AI response...');
    const aiResponse = await generateAIResponse(messageData, conversationHistory);
    
    if (!aiResponse.success) {
      console.log('❌ AI generation failed, flagging for human');
      return res.sendStatus(200);
    }
    
    console.log(`💭 AI Response: ${aiResponse.message}`);
    
    // Validate response
    const validation = validateAIResponse(aiResponse.message);
    if (!validation.valid) {
      console.log(`❌ Response validation failed: ${validation.reason}`);
      console.log('👤 Flagging for human review');
      return res.sendStatus(200);
    }
    
    // Send response
    console.log('📤 Sending AI response...');
    const sendResult = await sendSMS(customerPhone, aiResponse.message, messageData.to);
    
    if (sendResult.success) {
      recordResponse(customerPhone);
      console.log('✅ AI response sent successfully!');
    } else {
      console.log('❌ Failed to send AI response');
    }
    
    console.log('=== End Incoming Message Handler ===\n');
    res.sendStatus(200);
    
  } catch (error) {
    console.error('❌ Error in incoming message handler:', error);
    res.sendStatus(500);
  }
});

// ============================================
// HEALTH CHECK & TEST ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    service: 'brooklyn-bot-ai',
    timestamp: new Date().toISOString()
  });
});

app.get('/test', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'Brooklyn Bot AI Server',
    config: {
      hasOpenPhoneKey: !!OPENPHONE_API_KEY,
      hasAnthropicKey: !!ANTHROPIC_API_KEY,
      autoResponseEnabled: ENABLE_AUTO_RESPONSE,
      businessName: BUSINESS_NAME,
      testPhone: TEST_PHONE || 'Not set'
    }
  });
});

// Test Claude connection
app.get('/test-claude', async (req, res) => {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: 'Say "Hello from Claude!"'
        }
      ]
    });
    
    res.json({
      success: true,
      message: response.content[0].text,
      usage: response.usage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test AI response without sending (for testing prompts)
app.post('/test-ai-response', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const mockMessage = {
      content: message,
      from: '+11234567890'
    };
    
    const decision = await shouldAutoRespond(mockMessage, conversationHistory);
    const aiResponse = await generateAIResponse(mockMessage, conversationHistory);
    const validation = validateAIResponse(aiResponse.message);
    
    res.json({
      decision,
      aiResponse,
      validation,
      wouldSend: decision.shouldRespond && aiResponse.success && validation.valid
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log('\n🤖 ========================================');
  console.log(`   Brooklyn Bot AI Server`);
  console.log('========================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🏢 Business: ${BUSINESS_NAME}`);
  console.log(`🤖 Agent: ${AGENT_NAME}`);
  console.log(`📞 Test Phone: ${TEST_PHONE || 'Not configured'}`);
  console.log(`🔄 Auto-response: ${ENABLE_AUTO_RESPONSE ? 'ENABLED' : 'DISABLED'}`);
  console.log(`⏰ Business hours: ${BUSINESS_HOURS_START}:00 - ${BUSINESS_HOURS_END}:00`);
  console.log(`🚦 Rate limit: ${MAX_RESPONSES_PER_HOUR} per hour`);
  console.log('========================================\n');
  console.log('✅ Ready to receive webhooks!');
  console.log('');
});

