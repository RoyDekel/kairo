export class FlightProvider {
  /**
   * Search for flights using the provider's specific API.
   * @param {Object} searchRequest - The search parameters.
   * @param {string} searchRequest.origin - Departure airport code.
   * @param {string} searchRequest.destination - Arrival airport code.
   * @param {string} searchRequest.departureDate - YYYY-MM-DD date.
   * @param {string} [searchRequest.returnDate] - Optional YYYY-MM-DD return date.
   * @param {Object} searchRequest.passengers - Passenger count structure.
   * @param {number} searchRequest.passengers.adults
   * @param {number} searchRequest.passengers.children
   * @param {number} searchRequest.passengers.infants
   * @returns {Promise<Object>} Object containing { outbound: Flight[], return: Flight[] } mapped to standard client schema.
   */
  async searchAsync(searchRequest) {
    throw new Error("Method 'searchAsync()' must be implemented by subclasses.");
  }
}
