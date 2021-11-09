import { ServiceExtension } from './extensions/extension-interfaces';
/**
 * A ServiceDescription is a wrapper for all of the extensions that a user wants
 * to add to an ECS Service. It collects all of the extensions that are added
 * to a service, allowing each extension to query the full list of extensions
 * added to a service to determine information about how to self-configure.
 */
export declare class ServiceDescription {
    /**
     * The list of extensions that have been registered to run when
     * preparing this service.
     */
    extensions: Record<string, ServiceExtension>;
    /**
     * Adds a new extension to the service. The extensions mutate a service
     * to add resources to or configure properties for the service.
     *
     * @param extension - The extension that you wish to add
     */
    add(extension: ServiceExtension): this;
    /**
     * Get the extension with a specific name. This is generally used by
     * extensions in order to discover each other.
     *
     * @param name
     */
    get(name: string): ServiceExtension;
}
