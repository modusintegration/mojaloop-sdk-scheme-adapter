# Mojaloop SDK Scheme Adapter

## Fork description

This is a fork of [https://github.com/modusbox/mojaloop-sdk-scheme-adapter](https://github.com/modusbox/mojaloop-sdk-scheme-adapter) with the following additions:


- A `package.json` file on the root of the repo. This allows the repo to be imported as a library using a github reference in a package.json file, as in `"@modusintegration/mojaloop-sdk-scheme-adapter": "github:modusintegration/mojaloop-sdk-scheme-adapter#for-fxp-adapter"`

This is an interim approach until the upstream repo publishes the `lib` folder as components.

The `package.json` file has the same dependencies as all the `package.json` files on the `lib` folder and its subdirectories have, to make it easier on customers to import the dependencies.

It doesn't have any `file:` dependencies because `npm` can't handle a dependency from `github:` that itself has `file:` dependencies 






## Original Readme follows

This package provides a scheme adapter that interfaces between a Mojaloop API compliant switch and a DFSP backend platform that does not natively implement the Mojaloop API.

The API between the scheme adapter and the DFSP backend is synchronous HTTP while the interface between the scheme adapter and the switch is native Mojaloop API.

This package exemplifies the use of the Mojaloop SDK Standard Components for TLS, JWS and ILP (available [here](http://www.github.com/modusbox/mojaloop-sdk-standard-components)).

For information on the background and context of this project please see the presentation [here](docs/Mojaloop%20-%20Modusbox%20Onboarding%20functionality.pdf)

## DFSP Backend API

DFSP backends must implement the [DFSP Inbound API](docs/dfspInboundApi.yaml) in order for the scheme adapter to make incoming transfers i.e. to receive funds to a customer account.

DFSP backends can call the [DFSP Outbound API](/src/outboundApi/api.yaml) in order to make outgoing transfers i.e. to send funds from a customer account.

## Docker Image

This package is available as a pre-built docker image on Docker Hub: [https://hub.docker.com/r/modusbox/mojaloop-sdk-scheme-adapter](https://hub.docker.com/r/modusbox/mojaloop-sdk-scheme-adapter)

## Running locally

You need to create a .env file. You can create your own based on `local-dev.env` or `local.env', as in:

`cp local-dev.env .env`

The SDK needs a Redis instance. You can start one using docker:

```bash
docker run -p 6379:6379 --name mojabox-sdk-redis -d -v redis-data:/data redis:5.0.4-alpine redis-server --appendonly yes
docker logs -f mojabox-sdk-redis
```

And then run the SDK locally with `node index.js`
## Quick Start

The steps shown below illustrate setting up the Mojaloop SDK Scheme Adapter locally with a mock DFSP backend.

This configuration is suitable as a starting point for DFSPs wishing to utilize the scheme adapter for integrating their backend systems with a Mojaloop API enabled switch.

_Note that these instructions are for Linux based systems. For Mac and/or Windows you will need to translate the following for your environment._

1. Make sure you have docker and docker-compose installed locally. See [https://docs.docker.com/v17.12/install/](https://docs.docker.com/v17.12/install/) and [https://docs.docker.com/compose/install/](https://docs.docker.com/compose/install/) respectively.
2. Clone the Mojaloop SDK Mock DFSP Backend repository locally:

   Change directory into your workspace then to clone using HTTPS:

   ```bash
   $ git clone https://github.com/modusbox/mojaloop-sdk-mock-dfsp-backend.git
   ```

   or to clone using SSH:

   ```bash
   $ git clone git@github.com:modusbox/mojaloop-sdk-mock-dfsp-backend.git
   ```

   Now change directory into the cloned repository directory:

   ```bash
   $ cd mojaloop-sdk-mock-dfsp-backend
   ```

3. Edit the scheme adapter configuration to point the scheme adapter at your Mojaloop API enabled switch or simulator:

   Use your favourite text editor to edit the file `src/scheme-adapter.env`.
   Change the value of the `PEER_ENDPOINT` variable to the DNS name or IP address and port number of your Mojaloop API enabled switch or simulator.i
   Save the file.

4. Use docker-compose to download and run the pre-built scheme-adapter, shared cache and mock DFSP backend containers locally:

   Change directory into the `src` subfolder and run docker-compose

   ```bash
   $ cd src/
   $ docker-compose up
   ```

   You should see docker download the pre-built docker images for the scheme adapter, shared cache (redis) and mock DFSP backend. Docker-compose will start the containers.

5. Test the outbound (sending money) API:

   Find the IP address of the mock DFSP backend container. To do this you can use...

   ```bash
   docker network ls
   ``` 

   to find the list of docker networks on your local machine. Identity the docker network created by docker-compose, docker-compose will assign a name based on the directory name from which you ran the `docker-compose up` command.

   Once you have identified the network you can use...

   ```bash
   docker network inspect {network name}
   ```

   This will print a JSON structure to the terminal containing the set of containers in the network and their individual IP addresses.

   Use the following command to tell the mock DFSP backend to initiate an outbound money transfer via the scheme-adapter:

   _Dont forget to substitute in the correct IP address for the Mock DFSP Backend container_

   ```bash
   curl -X POST \
     http://{MOCK Container IP Address}:3000/send \
     -H 'Content-Type: application/json' \
     -d '{
       "from": {
           "displayName": "John Doe",
           "idType": "MSISDN",
           "idValue": "123456789"
       },
       "to": {
           "idType": "MSISDN",
           "idValue": "987654321"
       },
       "amountType": "SEND",
       "currency": "USD",
       "amount": "100",
       "transactionType": "TRANSFER",
       "note": "test payment",
       "homeTransactionId": "123ABC"
   }'
   ```

   The respose from the above call should indicate the result of the communication between the scheme-adapter and the Mojaloop API enabled switch or simulator.

6. Speak to your switch operator or use your simulator to test the inbound (receiving money) API.

You can now examine the code of the Mock DFSP backend to understand how it implements the scheme-adapter simplified inbound API.


