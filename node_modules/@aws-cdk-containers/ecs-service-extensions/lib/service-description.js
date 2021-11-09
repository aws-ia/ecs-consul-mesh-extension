"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceDescription = void 0;
/**
 * A ServiceDescription is a wrapper for all of the extensions that a user wants
 * to add to an ECS Service. It collects all of the extensions that are added
 * to a service, allowing each extension to query the full list of extensions
 * added to a service to determine information about how to self-configure.
 */
class ServiceDescription {
    constructor() {
        /**
         * The list of extensions that have been registered to run when
         * preparing this service.
         */
        this.extensions = {};
    }
    /**
     * Adds a new extension to the service. The extensions mutate a service
     * to add resources to or configure properties for the service.
     *
     * @param extension - The extension that you wish to add
     */
    add(extension) {
        if (this.extensions[extension.name]) {
            throw new Error(`An extension called ${extension.name} has already been added`);
        }
        this.extensions[extension.name] = extension;
        return this;
    }
    /**
     * Get the extension with a specific name. This is generally used by
     * extensions in order to discover each other.
     *
     * @param name
     */
    get(name) {
        return this.extensions[name];
    }
}
exports.ServiceDescription = ServiceDescription;
;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS1kZXNjcmlwdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNlcnZpY2UtZGVzY3JpcHRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUE7Ozs7O0dBS0c7QUFDSCxNQUFhLGtCQUFrQjtJQUEvQjtRQUNFOzs7V0FHRztRQUNJLGVBQVUsR0FBcUMsRUFBRSxDQUFDO0lBMkIzRCxDQUFDO0lBekJDOzs7OztPQUtHO0lBQ0ksR0FBRyxDQUFDLFNBQTJCO1FBQ3BDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsU0FBUyxDQUFDLElBQUkseUJBQXlCLENBQUMsQ0FBQztTQUNqRjtRQUVELElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLFNBQVMsQ0FBQztRQUU1QyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNJLEdBQUcsQ0FBQyxJQUFZO1FBQ3JCLE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvQixDQUFDO0NBQ0Y7QUFoQ0QsZ0RBZ0NDO0FBQUEsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNlcnZpY2VFeHRlbnNpb24gfSBmcm9tICcuL2V4dGVuc2lvbnMvZXh0ZW5zaW9uLWludGVyZmFjZXMnO1xuXG4vKipcbiAqIEEgU2VydmljZURlc2NyaXB0aW9uIGlzIGEgd3JhcHBlciBmb3IgYWxsIG9mIHRoZSBleHRlbnNpb25zIHRoYXQgYSB1c2VyIHdhbnRzXG4gKiB0byBhZGQgdG8gYW4gRUNTIFNlcnZpY2UuIEl0IGNvbGxlY3RzIGFsbCBvZiB0aGUgZXh0ZW5zaW9ucyB0aGF0IGFyZSBhZGRlZFxuICogdG8gYSBzZXJ2aWNlLCBhbGxvd2luZyBlYWNoIGV4dGVuc2lvbiB0byBxdWVyeSB0aGUgZnVsbCBsaXN0IG9mIGV4dGVuc2lvbnNcbiAqIGFkZGVkIHRvIGEgc2VydmljZSB0byBkZXRlcm1pbmUgaW5mb3JtYXRpb24gYWJvdXQgaG93IHRvIHNlbGYtY29uZmlndXJlLlxuICovXG5leHBvcnQgY2xhc3MgU2VydmljZURlc2NyaXB0aW9uIHtcbiAgLyoqXG4gICAqIFRoZSBsaXN0IG9mIGV4dGVuc2lvbnMgdGhhdCBoYXZlIGJlZW4gcmVnaXN0ZXJlZCB0byBydW4gd2hlblxuICAgKiBwcmVwYXJpbmcgdGhpcyBzZXJ2aWNlLlxuICAgKi9cbiAgcHVibGljIGV4dGVuc2lvbnM6IFJlY29yZDxzdHJpbmcsIFNlcnZpY2VFeHRlbnNpb24+ID0ge307XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBuZXcgZXh0ZW5zaW9uIHRvIHRoZSBzZXJ2aWNlLiBUaGUgZXh0ZW5zaW9ucyBtdXRhdGUgYSBzZXJ2aWNlXG4gICAqIHRvIGFkZCByZXNvdXJjZXMgdG8gb3IgY29uZmlndXJlIHByb3BlcnRpZXMgZm9yIHRoZSBzZXJ2aWNlLlxuICAgKlxuICAgKiBAcGFyYW0gZXh0ZW5zaW9uIC0gVGhlIGV4dGVuc2lvbiB0aGF0IHlvdSB3aXNoIHRvIGFkZFxuICAgKi9cbiAgcHVibGljIGFkZChleHRlbnNpb246IFNlcnZpY2VFeHRlbnNpb24pIHtcbiAgICBpZiAodGhpcy5leHRlbnNpb25zW2V4dGVuc2lvbi5uYW1lXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBbiBleHRlbnNpb24gY2FsbGVkICR7ZXh0ZW5zaW9uLm5hbWV9IGhhcyBhbHJlYWR5IGJlZW4gYWRkZWRgKTtcbiAgICB9XG5cbiAgICB0aGlzLmV4dGVuc2lvbnNbZXh0ZW5zaW9uLm5hbWVdID0gZXh0ZW5zaW9uO1xuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBleHRlbnNpb24gd2l0aCBhIHNwZWNpZmljIG5hbWUuIFRoaXMgaXMgZ2VuZXJhbGx5IHVzZWQgYnlcbiAgICogZXh0ZW5zaW9ucyBpbiBvcmRlciB0byBkaXNjb3ZlciBlYWNoIG90aGVyLlxuICAgKlxuICAgKiBAcGFyYW0gbmFtZVxuICAgKi9cbiAgcHVibGljIGdldChuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5leHRlbnNpb25zW25hbWVdO1xuICB9XG59O1xuIl19