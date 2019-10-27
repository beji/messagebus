import { getBus, getTopic, subscribe, sendMessage, BacklogStrategy, unsubscribe } from '.';

describe('messagebus', () => {
  test('does stuff as expected', () => {
    const bus = getBus();
    const topic = getTopic(bus, 'testtopic');

    const cb1 = jest.fn();
    const sub1 = subscribe(topic, cb1);
    expect(topic.subscriptions.length).toBe(1);

    expect(topic.subscriptions[0].id).toBe(sub1.id);

    sendMessage(topic, { some: 'message' });
    sendMessage(topic, { message: 'two' });
    sendMessage(topic, { message: 'three' });
    sendMessage(topic, { some: 'message' });
    expect(cb1).toHaveBeenCalledTimes(4);
    expect(topic.messages.length).toBe(4);

    const cb2 = jest.fn();
    subscribe(topic, cb2, { backlogStrategy: BacklogStrategy.IGNORE });
    expect(cb2).toHaveBeenCalledTimes(0);

    const cb3 = jest.fn();
    subscribe(topic, cb3, { backlogStrategy: BacklogStrategy.LATEST });
    expect(cb3).toHaveBeenCalledTimes(1);

    const cb4 = jest.fn();
    subscribe(topic, cb4, { backlogStrategy: BacklogStrategy.FULL });
    expect(cb4).toHaveBeenCalledTimes(4);

    subscribe(topic, cb1, { id: sub1.id });
    expect(cb1).toHaveBeenCalledTimes(4);

    unsubscribe(sub1);
    sendMessage(topic, { some: 'message' });
    sendMessage(topic, { some: 'message' });
    sendMessage(topic, { some: 'message' });
    sendMessage(topic, { some: 'message' });

    expect(cb1).toHaveBeenCalledTimes(4);
    expect(cb4).toHaveBeenCalledTimes(8);

    subscribe(topic, cb1, { id: sub1.id });
    expect(cb1).toHaveBeenCalledTimes(8);
  });
});

describe('cleanOldMessages', () => {
  it('cleans up when too many messages are stored', () => {
    const bus = getBus();
    const topic = getTopic(bus, 'testtopic', 5);
    for (let i = 0; i < 20; i += 1) {
      sendMessage(topic, {});
    }
    expect(topic.messages.length).toBe(5);
  });
  it("doesn't clean up infinite message logs", () => {
    const bus = getBus();
    const topic = getTopic(bus, 'testtopic');
    for (let i = 0; i < 20; i += 1) {
      sendMessage(topic, {});
    }
    expect(topic.messages.length).toBe(20);
  });
});
