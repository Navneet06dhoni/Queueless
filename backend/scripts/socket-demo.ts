import { io } from 'socket.io-client';
import { config } from '../src/config';

const accessToken = process.argv[2];
const businessId = process.argv[3];

if (!accessToken || !businessId) {
  console.error('\n❌ Usage: npm --prefix backend run demo:socket -- <accessToken> <businessId>\n');
  console.error('Example:');
  console.error('  npm --prefix backend run demo:socket -- eyJhbGciOi... 11111111-2222-3333-4444-555555555555\n');
  process.exit(1);
}

const serverUrl = `http://localhost:${config.PORT}`;
console.log(`🔌 Connecting to QueueLess Live WebSocket at ${serverUrl}...`);
console.log(`🎯 Watching Business ID: ${businessId}\n`);

const socket = io(serverUrl, {
  auth: {
    token: accessToken,
  },
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  console.log(`✅ [CONNECTED] Socket ID: ${socket.id}`);

  // Watch public queue
  socket.emit('queue:watch', { businessId }, (ack: any) => {
    console.log(`📡 [WATCH ACK] Subscribed to queue:${businessId}`);
    if (ack?.status) {
      console.log('   Current Status:', ack.status);
    } else if (ack?.error) {
      console.error('   Error:', ack.error);
    }
  });

  // Also attempt watch-owner (succeeds only if user is the business owner)
  socket.emit('queue:watch-owner', { businessId }, (ack: any) => {
    if (ack?.queue) {
      console.log('👑 [OWNER ACK] Subscribed to owner queue!');
      console.log('   Now Serving:', ack.queue.current?.name || 'None');
      console.log(`   Waiting count: ${ack.queue.waitingCount}`);
    }
  });
});

// Event listeners
socket.on('queue:updated', (data) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n📢 [${time}] EVENT: queue:updated`);
  console.log(`   Now Serving Ticket: ${data.nowServing || 'None'}`);
  console.log(`   Waiting in Line:    ${data.waitingCount}`);
  console.log(`   Est. Wait for Join: ${data.estimatedWaitMinutesForNewJoiner} min`);
});

socket.on('queue:position', (data) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n📍 [${time}] EVENT: queue:position (Your Personal Position)`);
  console.log(`   Ticket Number:   #${data.ticketNumber}`);
  console.log(`   Your Position:   ${data.position}`);
  console.log(`   People Ahead:    ${data.peopleAhead}`);
  console.log(`   Estimated Wait:  ${data.estimatedWaitMinutes} min`);
  console.log(`   Status:          ${data.status}`);
});

socket.on('queue:called', (data) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n🔔🔔🔔 [${time}] EVENT: queue:called 🔔🔔🔔`);
  console.log(`   🎉 TICKET #${data.ticketNumber} - IT IS YOUR TURN! Please proceed to counter.`);
});

socket.on('queue:removed', (data) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n⚠️ [${time}] EVENT: queue:removed`);
  console.log(`   You have left or completed the queue (Status: ${data.status}).`);
});

socket.on('queue:owner-updated', (data) => {
  const time = new Date().toLocaleTimeString();
  console.log(`\n📋 [${time}] EVENT: queue:owner-updated`);
  console.log(`   Active Served: ${data.current?.name || 'None'} (Ticket #${data.current?.ticketNumber || '-'})`);
  console.log(`   Waiting:       ${data.waiting.length} customer(s)`);
});

socket.on('connect_error', (err) => {
  console.error(`❌ Connection error: ${err.message}`);
});

socket.on('disconnect', (reason) => {
  console.warn(`🔌 Disconnected: ${reason}`);
});

// Graceful exit
process.on('SIGINT', () => {
  console.log('\n👋 Closing WebSocket demo listener...');
  socket.disconnect();
  process.exit(0);
});
