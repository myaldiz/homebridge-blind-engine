var noble = require('noble');
var Accessory, Service, Characteristic, UUIDGen;

const BLIND_SERVICE_UUID = 'fe50';
const BLIND_SET_CHAR_UUID = 'fe51';
const BLIND_SET_VALUE_BASE = 0x00ff00009a;

// Power on for scanning
noble.on('stateChange', function (state) {
    if (state === 'poweredOn') {
        noble.startScanning([BLIND_SERVICE_UUID]);
    } else {
        noble.stopScanning();
    }
});

module.exports = function (homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    // For platform plugin to be considered as dynamic platform plugin,
    // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
    homebridge.registerPlatform("homebridge-blind-platform", "BlindPlatform", BlindPlatform, true);
}


function BlindPlatform(log, config, api) {
    log("Blind Platform Init");
    var platform = this;
    this.log = log;
    this.config = config;
    this.accessories = [];

    noble.on('discover', function (peripheral) {
        peripheral.connect(function (error) {
            this.addAccessory(peripheral);
        });
    });

    if (api) {
        // Save the API object as plugin needs to register new accessory via this object
        this.api = api;

        // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
        // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
        // Or start discover new accessories.
        this.api.on('didFinishLaunching', function () {
            platform.log("DidFinishLaunching");
        }.bind(this));
    }
}

Accessory.prototype.getCurrentPosition = function (callback) {
    this.log("Requested CurrentPosition: %s", this.lastPosition);
    callback(null, this.lastPosition);
}

Accessory.prototype.getPositionState = function (callback) {
    this.log("Requested PositionState: %s", this.currentPositionState);
    callback(null, this.currentPositionState);
}

Accessory.prototype.getTargetPosition = function (callback) {
    this.log("Requested TargetPosition: %s", this.currentTargetPosition);
    callback(null, this.currentTargetPosition);
}

Accessory.prototype.setTargetPosition = function (pos, callback) {
    this.currentTargetPosition = pos;
    this.currentPositionState = 1;
    var platform = this;
    
    this.levelCharacteristic.write(
        new Buffer([BLIND_SET_VALUE_BASE, 0x0d, 0x01, 0x35, 0xa3]),
        true,
        function (error) {
            platform.log("Set TargetPosition: %s", pos);
            platform.lastPosition = pos;
            platform.currentPositionState = 2;
        }
    );
    callback(null);
}

// Sample function to show how developer can add accessory dynamically from outside event
BlindPlatform.prototype.addAccessory = function (peripheral) {
    this.log("Add Accessory");
    var platform = this;

    var newAccessory = new Accessory(peripheral.advertisement.localName, peripheral.uuid);
    newAccessory.on('identify', function (paired, callback) {
        platform.log(newAccessory.displayName, "Identify!!!");
        callback();
    });

    newAccessory.lastPosition = 100; // last known position of the blinds, open by default
    newAccessory.currentPositionState = 2; // stopped by default
    newAccessory.currentTargetPosition = 100; // open by default

    peripheral.discoverServices([BLIND_SERVICE_UUID], function (error, services) {
        var deviceInformationService = services[0];
        platform.log('discovered device information service');

        deviceInformationService.discoverCharacteristics([BLIND_SET_CHAR_UUID], function (error, characteristics) {
            var levelCharacteristic = characteristics[0];
            newAccessory.levelCharacteristic = levelCharacteristic;
            platform.log('discovered set-value characteristics');

            levelCharacteristic.write(new Buffer([BLIND_SET_VALUE_BASE, 0x0d, 0x01, 0x00, 0x96]), true, function (error) {
                platform.log('set blind level to 100');

            });
        });
    });

    newAccessory.addService(Service.WindowCovering, "CurrentPosition")
        .getCharacteristic(Characteristic.CurrentPosition)
        .on('get', newAccessory.getCurrentPosition.bind(newAccessory));

    // the position state (0 = DECREASING, 1 = INCREASING, 2 = STOPPED)
    newAccessory.addService(Service.WindowCovering, "PositionState")
        .getCharacteristic(Characteristic.PositionState)
        .on('get', newAccessory.getPositionState.bind(newAccessory));

    // the target position (0-100%)
    newAccessory.addService(Service.WindowCovering, "TargetPosition")
        .getCharacteristic(Characteristic.TargetPosition)
        .on('get', newAccessory.getTargetPosition.bind(newAccessory))
        .on('set', newAccessory.setTargetPosition.bind(newAccessory));


    // Plugin can save context on accessory to help restore accessory in configureAccessory()
    // newAccessory.context.something = "Something"

    // Make sure you provided a name for service, otherwise it may not visible in some HomeKit apps

    this.accessories.push(newAccessory);
    this.api.registerPlatformAccessories("homebridge-blind-platform", "BlindPlatform", [newAccessory]);
}
