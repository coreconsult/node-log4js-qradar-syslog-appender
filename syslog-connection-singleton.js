/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

export default class Singleton {
  constructor() {
    if (Singleton.instance) {
      return Singleton.instance;
    }

    Singleton.instance = this;

    this.connection = null;
    this.droppedMessages = 0;
    this.circuitBreak = false;
    this.MAX_TRIES = 3;
    this.CIRCUIT_BREAK_MINS = 10;

    return this;
  }
}
