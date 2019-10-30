declare global {
  interface Window {
    bus: Bus;
  }
}


type MessageID = number;
type TopicID = string;
type SubscriptionID = number;
type SubscriptionCallback = (message: Message) => void;

export type Message = {
  readonly id: MessageID;
  readonly payload: object;
  readonly timestamp: Date;
};

export type Topic = {
  readonly name: TopicID;
  messages: Message[];
  subscriptions: Subscription[];
  readonly maxLogSize: number;
  nextSubId: number;
  nextMessageID: number;
};

export type Bus = {
  topics: Topic[];
};

export type Subscription = {
  readonly id: SubscriptionID;
  readonly topic: TopicID;
  lastMessageId: MessageID | null;
  callback: SubscriptionCallback;
  active: boolean;
};

export const enum BacklogStrategy {
  IGNORE = 'ignore',
  LATEST = 'latest',
  FULL = 'full'
}

export type SubsciptionOptions = {
  readonly id?: SubscriptionID;
  readonly backlogStrategy?: BacklogStrategy;
  startActive?: boolean;
};

/**
 * Creates a bus object. If `window` exists and it has a bus object it will return that one.
 * Otherwise it will create a new object and add it to the `window` object if that exists.
 *
 * The idea is that there will only be one bus at a time.
 */
export const getBus = (): Bus => {
  if (typeof window !== 'undefined' && window.bus) {
    return window.bus;
  }
  const bus: Bus = {
    topics: [],
  };
  if (typeof window !== 'undefined') {
    window.bus = bus;
  }
  return bus;
};

/**
 * Creates a new topic on the bus object or returns an existing topic if the bus already has a topic of the same name
 *
 * @see {@link getBus}
 *
 * @param bus the message bus
 * @param name the name of the (maybe) new topic
 * @param maxLogSize the maximum number of messages that should be kept, defaults to -1 = all of them
 */
export const getTopic = (bus: Bus, name: TopicID, maxLogSize?: number): Topic => {
  const maybeExisting = bus.topics.find(topic => topic.name === name);
  if (maybeExisting) {
    return maybeExisting;
  }
  const topic: Topic = {
    name,
    messages: [],
    subscriptions: [],
    maxLogSize: maxLogSize || -1,
    nextMessageID: 0,
    nextSubId: 0
  };
  bus.topics.push(topic);
  return topic;
};

/**
 *
 * Subscribe a callback to a topic.
 *
 * The id of the subscription can be configured in the options parameter, otherwise a uuid will be generated.
 * If you try to subscribe with the same id twice the existing object will be updated in place with the new configuration.
 * Note that this can NOT change the topic the subscription uses.
 *
 * The topic might already have messages at the point of subscription, the backlogStrategy in the options parameter can be used to determine what should happen in this case.
 * - `ignore`: old messages will simply be ignored
 * - `latest`: the callback will be executed for the most recent message on the topic
 * - `full`: the callback will be executed for every message on the topic
 * The default value is `full`.
 *
 * The subscription can be set to inactive in the options, this will mean that the subscription will not get any messages.
 * This can be changed by simply calling `subscribe` again with the same id and active set to true.
 *
 * @param topic the topic to subscribe to
 * @param callback the callback that the subscription should execute on a new message
 * @param options optional configuration for the subscription
 *
 * @returns the subscription object
 */
export const subscribe = (
  topic: Topic,
  callback: SubscriptionCallback,
  options?: SubsciptionOptions
): Subscription => {
  // a parameter can't be both optional and have default values so this is done manually here
  const backlogStrategy =
    options && options.backlogStrategy ? options.backlogStrategy : BacklogStrategy.FULL;
  const startActive = options && options.startActive ? options.startActive : true;

  const id = options && typeof options.id !== 'undefined' ? options.id : topic.nextSubId;

  const { name: topicName, messages } = topic;
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastMessageId = lastMessage ? lastMessage.id : null;
  const maybeExisting = topic.subscriptions.find(subscription => subscription.id === id);

  if (maybeExisting) {
    if (
      maybeExisting.lastMessageId &&
      maybeExisting.lastMessageId !== lastMessageId &&
      lastMessage &&
      startActive
    ) {
      switch (backlogStrategy) {
        case BacklogStrategy.FULL:
          {
            const lastSeenMessageIndex = messages.findIndex(
              message => message.id === maybeExisting.lastMessageId
            );
            const backlog = messages.filter((_, idx) => idx > lastSeenMessageIndex);
            backlog.forEach(message => callback(message));
          }
          break;
        case BacklogStrategy.LATEST:
          callback(lastMessage);
          break;
        default:
          break;
      }
    }
    // Update the callback
    maybeExisting.callback = callback;
    // This might have changed depending on the strategy
    maybeExisting.lastMessageId = lastMessageId;
    maybeExisting.active = startActive;
    return maybeExisting;
  }

  switch (backlogStrategy) {
    case BacklogStrategy.FULL:
      messages.forEach(message => callback(message));
      break;
    case BacklogStrategy.LATEST:
      if (lastMessage) {
        callback(lastMessage);
      }
      break;
    default:
      break;
  }

  const subscription: Subscription = {
    id,
    topic: topicName,
    callback,
    lastMessageId,
    active: startActive
  };
  topic.subscriptions.push(subscription);
  topic.nextSubId = topic.nextSubId + 1;
  return subscription;
};

/**
 * Removes the oldest messages from the topics message log if maxLogSize is set to anything but -1 and the log size exceeds maxLogSize
 * @param topic the topic to clean
 */
const cleanOldMessages = (topic: Topic): void => {
  // log is infinite, don't do anything
  if (topic.maxLogSize === -1) {
    return;
  }
  while (topic.messages.length > topic.maxLogSize) {
    topic.messages.shift();
  }
};

/**
 * This will trigger the callbacks of all active subscriptions on the topic and pass the given payload to them.
 * It will also add the message to the topics message log and update the lastMessageId on all active subscriptions.
 *
 * This might also lead to old messages being removed from the topic depending on the maxLogSize set for it.
 *
 * @param topic the topic to send the message on
 * @param payload the data that should be included in the message
 */
export const sendMessage = (topic: Topic, payload: object): void => {
  const message: Message = {
    id: topic.nextMessageID,
    payload,
    timestamp: new Date()
  };
  topic.messages.push(message);
  topic.nextMessageID = topic.nextMessageID + 1;
  cleanOldMessages(topic);
  topic.subscriptions
    // Don't map here, we want to modify the subscription elements in place
    .forEach(subscription => {
      if (subscription.active) {
        // Don't spread, that would generate a new object and break bindings;
        subscription.callback(message);
        subscription.lastMessageId = message.id;
      }
      return subscription;
    });
};

/**
 * This stops the given subscription from getting any messages by setting it to inactive.
 * Note that this will not clean up the subscription from the topic, this is not a garbage collection.
 *
 * @param subscription the subscription that should not get messages
 */
export const unsubscribe = (subscription: Subscription): void => {
  subscription.active = false;
};
