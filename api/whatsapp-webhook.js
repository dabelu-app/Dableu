const FormData = require('form-data');
const fetch    = require('node-fetch');

const FIREBASE_API_KEY = 'AIzaSyDFlOUqSUmdN6aGQe-Qz1LkGxlVg0c0BM0';
const FIREBASE_PROJECT  = 'dabelu';
const SITE_URL          = 'https://cosmic-daifuku-4d8c28.netlify.app';

async function sendWhatsAppReply(chatId, message) {
  const instance = process.env.GREENAPI_INSTANCE;
  const token    = process.env.GREENAPI_TOKEN;
  await fetch(
    `https://7107.api.greenapi.com/waInstance${instance}/sendMessage/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    }
  );
}

async function queryFirestoreByChatId(phone) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'chatId' },
              op: 'EQUAL',
              value: { stringValue: phone }
            }
          },
          limit: 1
        }
      })
    }
  );
  const data = await resp.json();
  return Array.isArray(data) && data.length > 0 && data[0].document;
}

async function isRegisteredUser(phone) {
  // Try exact match first
  if (await queryFirestoreByChatId(phone)) return true;
  // Try with leading 0 (e.g. 972502127441 → 0502127441)
  if (phone.startsWith('972')) {
    if (await queryFirestoreByChatId('0' + phone.slice(3))) return true;
  }
  // Try with 972 prefix (e.g. 0502127441 → 972502127441)
  if (phone.startsWith('0')) {
    if (await queryFirestoreByChatId('972' + phone.slice(1))) return true;
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const body = req.body;
  if (!body || body.typeWebhook !== 'incomingMessageReceived')
    return res.status(200).send('ok');

  const { messageData, senderData } = body;
  const senderName = senderData?.senderName || senderData?.sender || 'לא ידוע';
  const chatId     = senderData?.chatId;
  const msgType    = messageData?.typeMessage;
  const phone      = chatId ? chatId.replace('@c.us','').replace('@g.us','') : '';

  let isRegistered = false;
  try { isRegistered = !!(await isRegisteredUser(phone)); }
  catch (err) { console.error('User lookup:', err); }

  if (!isRegistered) {
    if (chatId) await sendWhatsAppReply(chatId,
      `❌ אינך מנוי במערכת Dabelu.\n\nלהרשמה לחץ כאן:\n${SITE_URL}`);
    return res.status(200).send('not registered');
  }

  let taskTitle = '';
  try {
    if (msgType === 'textMessage') {
      taskTitle = messageData.textMessageData?.textMessage || '';

    } else if (['audioMessage','voiceMessage','pttMessage'].includes(msgType)) {
      const idMessage = body.idMessage;
      const instance  = process.env.GREENAPI_INSTANCE;
      const token     = process.env.GREENAPI_TOKEN;

      // נסה לקבל URL ישירות מה-messageData
      let audioUrl = messageData?.fileMessageData?.downloadUrl
                  || messageData?.pttMessageData?.downloadUrl
                  || null;

      // אם אין — קרא ל-downloadFile
      if (!audioUrl) {
        const dlResp = await fetch(
          `https://7107.api.greenapi.com/waInstance${instance}/downloadFile/${token}`,
          { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ chatId, idMessage }) }
        );
        const dlData = await dlResp.json();
        audioUrl = dlData.downloadUrl;
        if (!audioUrl) throw new Error('downloadFile failed: ' + JSON.stringify(dlData));
      }

      const audioResp   = await fetch(audioUrl);
      if (!audioResp.ok) throw new Error('Audio fetch failed: ' + audioResp.status);
      const audioBuffer = await audioResp.buffer();
      if (!audioBuffer || audioBuffer.length === 0) throw new Error('Empty audio buffer');

      const form = new FormData();
      form.append('file', audioBuffer, { filename:'voice.ogg', contentType:'audio/ogg' });
      form.append('model', 'whisper-large-v3');
      form.append('prompt', 'שמות ישראלים, עסקים, משימות עבודה, מינוחים פיננסיים, מונחי מס ומקדמות.');
      form.append('language', 'he');

      const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization:`Bearer ${process.env.GROQ_KEY}`, ...form.getHeaders() },
        body: form
      });
      const whisperData = await whisperResp.json();
      if (whisperData.error) throw new Error('Whisper error: ' + whisperData.error.message);
      taskTitle = whisperData.text || '';

    } else {
      return res.status(200).send('unsupported');
    }
  } catch (err) {
    console.error('Processing error:', err);
    if (chatId) await sendWhatsAppReply(chatId, '❌ שגיאה: ' + err.message);
    return res.status(200).send('error');
  }

  if (!taskTitle.trim()) return res.status(200).send('empty');

  // ולידציה — האם זו משימה תקינה? (דרך Groq - חינמי)
  let isValidTask = false;
  try {
    const gptResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You decide if a Hebrew message is a valid work task. A valid task must contain a clear action or subject (name + action, job to do, reminder, etc). Answer only "כן" if valid, or "לא" if it is noise, test, single meaningless word, or unclear.'
          },
          { role: 'user', content: taskTitle.trim() }
        ],
        max_tokens: 5,
        temperature: 0
      })
    });
    const gptData = await gptResp.json();
    const answer = (gptData.choices?.[0]?.message?.content || '').trim();
    if (answer.startsWith('כן')) isValidTask = true;
  } catch (err) {
    console.error('GPT validation error:', err);
    isValidTask = true; // במקרה של שגיאה — נמשיך לשמור
  }

  if (!isValidTask) {
    if (chatId) await sendWhatsAppReply(chatId,
      '⚠️ הודעה אינה ברורה, נא שילחו שנית.');
    return res.status(200).send('unclear');
  }

  let firestoreOk = false;
  try {
    const fsResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/tasks?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            title:       { stringValue: taskTitle.trim() },
            clientName:  { stringValue: senderName },
            source:      { stringValue: msgType==='textMessage' ? 'whatsapp-text' : 'whatsapp-voice' },
            status:      { stringValue: 'pending' },
            priority:    { stringValue: 'normal' },
            createdAt:   { stringValue: new Date().toISOString() },
            description: { stringValue: msgType!=='textMessage' ? '🎤 תומלל מהודעה קולית' : '' }
          }
        })
      }
    );
    firestoreOk = fsResp.ok;
  } catch (err) { console.error('Firestore:', err); }

  if (chatId) {
    await sendWhatsAppReply(chatId, firestoreOk
      ? `✅ המשימה נוצרה בהצלחה!\n📝 ${taskTitle.trim()}`
      : '⚠️ ההודעה התקבלה אך הייתה בעיה בשמירה.');
  }

  return res.status(200).json({ ok: true, task: taskTitle });
};
