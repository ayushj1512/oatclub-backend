import EventEmitter from "events";

export const EVENTS = {
  USER_REGISTERED: "USER_REGISTERED",
  ORDER_UPDATED: "ORDER_UPDATED",
  ORDER_CONFIRMED: "ORDER_CONFIRMED",
  ORDER_RECEIVED: "ORDER_RECEIVED",
  RMA_REQUESTED: "RMA_REQUESTED",
};

export const eventBus = new EventEmitter();
