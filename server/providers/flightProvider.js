export class FlightProvider {
  /**
   * Search for flights using the provider's specific API.
   *
   * Abstract: this base implementation only throws. The parameter is underscore-prefixed
   * because nothing here reads it — it exists to document the shape every subclass must
   * accept, which is the whole point of the class.
   *
   * @param {Object} _searchRequest - The search parameters.
   * @param {string} _searchRequest.origin - Departure airport code.
   * @param {string} _searchRequest.destination - Arrival airport code.
   * @param {string} _searchRequest.departureDate - YYYY-MM-DD date.
   * @param {string} [_searchRequest.returnDate] - Optional YYYY-MM-DD return date.
   * @param {Object} _searchRequest.passengers - Passenger count structure.
   * @param {number} _searchRequest.passengers.adults
   * @param {number} _searchRequest.passengers.children
   * @param {number} _searchRequest.passengers.infants
   * @returns {Promise<Object>} Object containing { outbound: Flight[], return: Flight[] } mapped to standard client schema.
   */
  async searchAsync(_searchRequest) {
    throw new Error("Method 'searchAsync()' must be implemented by subclasses.");
  }
}
